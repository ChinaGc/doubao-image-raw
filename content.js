console.log("content start");
// ===================== 页面注入隔离脚本 =====================
(function injectScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inject.js");
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
})();

// ===================== 常量配置区【置顶统一管理】 =====================
const STORAGE_KEY_IMG = "raw_image_bucket";
const STORAGE_KEY_VID = "raw_video_bucket";
const STORAGE_KEY_USER = 'user_token';
const CONFIG_KEY = 'remoteConfig';

// DOM/样式常量
const BTN_STYLE = `
    display: inline-block;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    position:absolute;
    top:0;
`;
const OBSERVER_OPT = { childList: true, subtree: true };
const OBSERVE_DELAY = 300;
const BTN_RESET_DELAY = 4000;


// ===================== 上下文&Storage安全工具 =====================
/** 校验插件上下文是否有效，防止Extension context invalidated */
function isCtxValid() {
    try {
        return !!chrome?.storage?.local;
    } catch {
        return false;
    }
}

/** 安全读取storage */
async function safeGet(key) {
    if (!isCtxValid()) return {};
    try {
        return await chrome.storage.local.get(key);
    } catch (err) {
        console.warn('存储读取失败(上下文失效)', err);
        return {};
    }
}

/** 安全写入storage */
async function safeSet(obj) {
    if (!isCtxValid()) return;
    try {
        await chrome.storage.local.set(obj);
    } catch (err) {
        console.warn('存储写入失败(上下文失效)', err);
    }
}

/** 安全删除指定key */
async function safeRemove(keyArr) {
    if (!isCtxValid()) return;
    try {
        await chrome.storage.local.remove(keyArr);
    } catch (err) {
        console.warn('存储删除失败(上下文失效)', err);
    }
}

// ===================== 简易BASE64时效Token工具【替换原JWT代码】 =====================
/** 解密：token(base64) → 原始过期秒时间戳 */

// 和签发脚本完全一致
const SEC_KEY = 2789451632;
const PRE_FIX = "sdf@_k9";
const SUF_FIX = "&23z_pq";
/** 解密：token→base64→去前后掩码→异或→真实过期时间戳 */
function decodeExp(token) {
  try {
    const raw = atob(token);
    // 裁剪前缀
    let body = raw.slice(PRE_FIX.length);
    // 裁剪后缀
    body = body.slice(0, body.length - SUF_FIX.length);
    const cipherNum = Number(body);
    if (isNaN(cipherNum)) return NaN;
    // 异或还原原始过期时间
    const realExp = cipherNum ^ SEC_KEY;
    return realExp;
  } catch {
    return NaN;
  }
}

/** 简易token时效校验（替换旧JWT校验） */
async function checkUserToken() {
    const tokenObj = await safeGet(STORAGE_KEY_USER);
    const token = tokenObj?.[STORAGE_KEY_USER];

    if (!token) {
        return { valid: false, msg: '激活码为空，请在插件弹窗填写激活码', count: 0 };
    }
    // 解码
    const exp = decodeExp(token);
    const nowSec = Date.now() / 1000;
    if (isNaN(exp) || exp < nowSec) {
        return { valid: false, msg: '激活码无效或已过期，请联系作者重新获取', count: 0 };
    }
    return { valid: true };
}




// ===================== 通用工具方法 =====================
function getKeyFromUrl(url) {
    try {
        const urlObj = new URL(url, location.origin);
        return urlObj.pathname;
    } catch {
        return url;
    }
}

/** 去除前缀数字_数字_，返回纯图片key */
function normalizeKey(trackKey) {
    return trackKey.replace(/^\d+_\d+_/, '');
}

// ===================== 图片/视频存储写入封装 =====================
async function saveImages(images) {
    if (!Object.keys(images).length) return;
    const storage = await safeGet(STORAGE_KEY_IMG);
    const bucket = storage[STORAGE_KEY_IMG] || {};
    Object.assign(bucket, images);
    await safeSet({ [STORAGE_KEY_IMG]: bucket });
}

async function saveVideos(videos) {
    if (!Object.keys(videos).length) return;
    const storage = await safeGet(STORAGE_KEY_VID);
    const bucket = storage[STORAGE_KEY_VID] || {};
    Object.assign(bucket, videos);
    await safeSet({ [STORAGE_KEY_VID]: bucket });
}

// ===================== 接口报文解析逻辑 =====================
async function parseChainSingle(jsonData) {
    if (!Object.hasOwn(jsonData, "downlink_body")) return;

    const imageBucket = {};
    const videoBucket = {};
    const messages = jsonData?.downlink_body?.pull_singe_chain_downlink_body?.messages || [];

    for (const message of messages) {
        if (message.user_type !== 2 || !message.content_block) continue;
        const contentBlock = message.content_block;

        if (Array.isArray(contentBlock)) {
            for (const block of contentBlock) {
                const creations = block.content?.creation_block?.creations;
                if (!Array.isArray(creations)) continue;

                for (const item of creations) {
                    if (item.type === 1 && item.image) {
                        imageBucket[item.image.key] = item.image;
                    } else if (item.type === 2 && item.video?.cover?.image_thumb?.url) {
                        const key = getKeyFromUrl(item.video.cover.image_thumb.url);
                        videoBucket[key] = item.video;
                    }
                }
            }
        }
    }

    await saveImages(imageBucket);
    await saveVideos(videoBucket);
}

async function parseChatComplete(eventStreamBody) {
    console.log('解析eventStreamBody');
    const imageBucket = {};
    const videoBucket = {};

    const lines = eventStreamBody.split(/\r?\n/).filter(line => line.trim());
    for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.replace('data:', '').trim();
        try {
            const json = JSON.parse(raw);

            // 分片消息
            if (json.patch_op && Array.isArray(json.patch_op)) {
                for (const op of json.patch_op) {
                    const patchVal = op.patch_value;
                    if (!patchVal?.content_block) continue;
                    for (const block of patchVal.content_block) {
                        if (block.block_type === 2074 && block.content?.creation_block?.creations) {
                            const creations = block.content.creation_block.creations;
                            for (const item of creations) {
                                if (item.type === 1 && item.image?.key) {
                                    imageBucket[item.image.key] = item.image;
                                } else if (item.type === 2 && item.video?.cover?.image_thumb?.url) {
                                    const key = getKeyFromUrl(item.video.cover.image_thumb.url);
                                    videoBucket[key] = item.video;
                                }
                            }
                        }
                    }
                }
            }

            // 全量消息
            if (json.message && json.message.content_block) {
                for (const block of json.message.content_block) {
                    if (block.block_type === 2074 && block.content?.creation_block?.creations) {
                        const creations = block.content.creation_block.creations;
                        for (const item of creations) {
                            if (item.type === 1 && item.image?.key) {
                                imageBucket[item.image.key] = item.image;
                            } else if (item.type === 2 && item.video?.vid) {
                                videoBucket[item.video.vid] = item.video;
                            }
                        }
                    }
                }
            }
        } catch {
            continue;
        }
    }

    await saveImages(imageBucket);
    await saveVideos(videoBucket);
}


// ===================== inject页面跨域消息监听 =====================
window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data.source !== "doubao-image-raw") return;

    try {
        if (data.api.includes("/im/chain/single")) {
            const jsonData = JSON.parse(data.body);
            await parseChainSingle(jsonData);
        } else if (data.api.includes('/chat/completion')) {
            await parseChatComplete(data.body);
        }
    } catch (e) {
        console.error("解析失败", e);
    }
});

// ===================== 图片/视频扫描主逻辑 =====================
async function scanImages(node) {
    const tokenCheck = await checkUserToken();
    if (!tokenCheck.valid) return { msg: tokenCheck.msg, count: tokenCheck.count };

    let count = 0;
    const images = (node || document).querySelectorAll('img[loading="lazy"][alt="image"][class*="image-"]');
    for (const img of images) {
        if (await createDownloadLink(img)) count++;
    }
    return { msg: `刚刚成功处理了${count}张图片`, count };
}

async function scanVideos(node) {
    const tokenCheck = await checkUserToken();
    if (!tokenCheck.valid) return { msg: tokenCheck.msg, count: tokenCheck.count };

    let count = 0;
    const coverImages = (node || document).querySelectorAll('img[class*="cover-"]');
    for (const img of coverImages) {
        if (await createDownloadVideoLink(img)) count++;
    }
    return { msg: `刚刚成功处理了${count}条视频`, count };
}

// ===================== 下载按钮生成&下载请求 =====================
async function getUrlByVid(vid) {
    const url = 'https://www.doubao.com/samantha/media/get_play_info?version_code=20800&language=zh-CN&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=&pc_version=2.51.7&region=&sys_region=&samantha_web=1&use-olympus-account=1&web_tab_id=';
    try {
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'origin': 'https://www.doubao.com',
            },
            body: JSON.stringify({ key: vid }),
        });
        const result = await res.json();
        if (!result?.data) {
            console.log('API failed', result);
            return false;
        }
        return result.data.original_media_info.main_url;
    } catch (e) {
        console.error('获取视频播放信息失败:', e);
        return null;
    }
}

async function createDownloadVideoLink(img) {
    if (img.dataset.originHandled === '1') return 1;
    const key = getKeyFromUrl(img.src);
    if (!key) return 0;

    // 创建按钮
    const button = document.createElement('button');
    button.style.cssText = BTN_STYLE;

    // 读取缓存数据
    const store = await safeGet(STORAGE_KEY_VID);
    const bucket = store[STORAGE_KEY_VID] || {};
    const data = bucket[key];
    const isExsitRaw = !!data?.vid;

    button.innerText = isExsitRaw ? '下载原视频' : '处理失败';
    button.style.zIndex = isExsitRaw ? 999 : 1;
    button.style.color = isExsitRaw ? 'green' : 'red';
    img.dataset.originHandled = isExsitRaw ? '1' : '0';

    // 点击下载
    button.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isExsitRaw) return;
        button.disabled = true;
        button.innerText = '获取视频地址...';
        try {
            const playUrl = await getUrlByVid(data.vid);
            if (!playUrl) {
                button.innerText = '获取失败';
                setTimeout(() => {
                    button.innerText = '下载原视频';
                    button.disabled = false;
                }, 1000);
                return;
            }
            button.innerText = '提交下载...';
            chrome.runtime.sendMessage({
                action: "downloadImage",
                url: playUrl,
                filename: `${data.vid}-无水印视频.mp4`
            }, (res) => {
                if (chrome.runtime.lastError) {
                    button.innerText = '下载失败';
                    setTimeout(() => {
                        button.innerText = '下载原视频';
                        button.disabled = false;
                    }, 1000);
                    return;
                }
                if (!res?.success) {
                    button.innerText = '下载失败';
                    setTimeout(() => {
                        button.innerText = '下载原视频';
                        button.disabled = false;
                    }, 1000);
                    return;
                }
                button.innerText = '已开始下载';
                setTimeout(() => {
                    button.innerText = '下载原视频';
                    button.disabled = false;
                }, 800);
            });
        } catch (err) {
            console.error(err);
            button.innerText = '下载失败';
            setTimeout(() => {
                button.innerText = '下载原视频';
                button.disabled = false;
            }, 1000);
        }
    });

    img.after(button);
    return isExsitRaw;
}

async function createDownloadLink(img) {
    if (img.dataset.originHandled === '1') return 1;
    const key = img.dataset.trackKey ? normalizeKey(img.dataset.trackKey) : null;
    if (!key) {
        // 无key，图片加载完重试
        img.onload = () => setTimeout(() => createDownloadLink(img), OBSERVE_DELAY);
        return 1;
    }

    const button = document.createElement('button');
    button.style.cssText = BTN_STYLE;

    const store = await safeGet(STORAGE_KEY_IMG);
    const bucket = store[STORAGE_KEY_IMG] || {};
    const data = bucket[key];
    const isExsitRaw = !!(data?.image_ori_raw && data.gen_params);

    button.innerText = isExsitRaw ? '下载原图' : '处理失败';
    button.style.zIndex = isExsitRaw ? 999 : 1;
    button.style.color = isExsitRaw ? 'green' : 'red';
    img.dataset.originHandled = isExsitRaw ? '1' : '0';

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isExsitRaw) return;

        button.disabled = true;
        button.innerText = '正在下载....';

        chrome.runtime.sendMessage({
            action: "downloadImage",
            url: data.image_ori_raw.url,
            filename: `${data.gen_params.prompt}-无水印原图.png`
        }, (res) => {
            if (chrome.runtime.lastError) {
                button.innerText = '下载失败';
                setTimeout(() => {
                    button.innerText = '下载原图';
                    button.disabled = false;
                }, 1000);
                return;
            }
            if (!res?.success) {
                button.innerText = '下载失败';
                setTimeout(() => {
                    button.innerText = '下载原图';
                    button.disabled = false;
                }, 1000);
                return;
            }
            button.innerText = '已加入下载';
            setTimeout(() => {
                button.innerText = '下载原图';
                button.disabled = false;
            }, 800);
        });
    });

    img.closest('picture')?.after(button);
    img.onload = null;
    return isExsitRaw;
}

// ===================== DOM变动监听（自动新增按钮） =====================
const imgObserver = new MutationObserver(mutList => {
    mutList.forEach(mut => {
        mut.addedNodes.forEach(node => {
            if (node.querySelectorAll) {
                setTimeout(() => {
                    scanImages(node);
                    scanVideos(node);
                }, OBSERVE_DELAY);
            }
        });
    });
});

document.addEventListener("DOMContentLoaded", () => {
    imgObserver.observe(document.body, OBSERVER_OPT);
});

// ===================== 插件内部runtime消息接收 =====================
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'scanImages') {
        const r = await scanImages();
        const vr = await scanVideos();
        sendResponse({ r: r, vr: vr });
    }
    return true;
});