const STORAGE_KEY_IMG = "raw_image_bucket";
const STORAGE_KEY_VID = "raw_video_bucket";
const STORAGE_KEY_USER = 'user_token';
const CONFIG_KEY = 'remoteConfig';
console.log("content start");

// ===================== 全局安全工具：解决上下文失效报错 =====================
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

// ===================== 注入隔离脚本（保留原有注入逻辑） =====================
const script = document.createElement("script");
script.src = chrome.runtime.getURL("inject.js");
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();

// ===================== 公共工具函数 =====================
function getKeyFromUrl(url) {
    try {
        const urlObj = new URL(url, location.origin);
        return urlObj.pathname;
    } catch {
        return url;
    }
}

/**
 * 去除前缀数字_数字_，返回纯图片key
 * @param {string} trackKey 原始key
 * @returns {string} 去掉前缀后的key
 */
function normalizeKey(trackKey) {
    // 正则：匹配开头两段数字+下划线 xxx_xxx_
    return trackKey.replace(/^\d+_\d+_/, '');
}

// ===================== 图片/视频持久化存储封装 =====================
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

// ===================== 接口数据解析 im/chain/single =====================
async function parseChainSingle(jsonData) {
    if (!Object.hasOwn(jsonData, "downlink_body")) return;

    // 清空旧数据（改用安全删除）
    //await safeRemove([STORAGE_KEY_IMG, STORAGE_KEY_VID]);

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
                        const imageKey = item.image.key;
                        imageBucket[imageKey] = item.image;
                    } else if (item.type === 2 && item.video?.cover?.image_thumb?.url) {
                        const key = getKeyFromUrl(item.video?.cover?.image_thumb?.url);
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

    // SSE按换行切分，过滤空行
    const lines = eventStreamBody.split(/\r?\n/).filter(line => line.trim());
    for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.replace('data:', '').trim();
        try {
            const json = JSON.parse(raw);

            // 1、STREAM_CHUNK 分片消息（核心生成图片）
            if (json.patch_op && Array.isArray(json.patch_op)) {
                for (const op of json.patch_op) {
                    const patchVal = op.patch_value;
                    if (!patchVal?.content_block) continue;
                    for (const block of patchVal.content_block) {
                        // block_type=2074=AI生成资源块
                        if (block.block_type === 2074 && block.content?.creation_block?.creations) {
                            const creations = block.content.creation_block.creations;
                            for (const item of creations) {
                                // type=1 图片
                                if (item.type === 1 && item.image?.key) {
                                    // key为image.key，value存完整image对象
                                    imageBucket[item.image.key] = item.image;
                                }
                                // type=2 视频(当前报文无，预留)
                                else if (item.type === 2 && item.video?.cover?.image_thumb?.url) {
                                    const key = getKeyFromUrl(item.video?.cover?.image_thumb?.url);
                                    videoBucket[key] = item.video;
                                }
                            }
                        }
                    }
                }
            }

            // 2、FULL_MSG_NOTIFY 全量首消息
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

        } catch (e) {
            // 心跳空data、非JSON直接跳过
            continue;
        }
    }

    await saveImages(imageBucket);
    await saveVideos(videoBucket);
}


// ===================== 监听inject.js页面通信message =====================
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

// ===================== 插件内部通信：scanImages扫描图片 =====================
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'scanImages') {
        const r = await scanImages();
        const vr = await scanVideos();
        sendResponse({ r: r, vr: vr });
    } else if (request.action === 'setConfig') {
        console.log(request.config)
    }
    return true;
});

// ===================== 图片处理：生成下载按钮 =====================
async function scanImages(node) {

    const tokenObj = await safeGet(STORAGE_KEY_USER);
    // 取出真实token字符串
    const token = tokenObj?.[STORAGE_KEY_USER];

    // 1、无token
    if (!token) {
        return { msg: `token为空，请在插件弹窗填写token`, count: 0 }
    }
    // 2、JWT格式错误 || 已过期
    if (!checkJwtValid(token)) {
        return { msg: `token无效或已过期，请联系作者重新获取`, count: 0 }
    }


    let count = 0;
    const images = (node || document).querySelectorAll('img[loading="lazy"][alt="image"][class*="image-"]');
    for (const img of images) {
        if (await createDownloadLink(img)) {
            count++;
        }
    }
    return { msg: `刚刚成功处理了${count}张图片` }
}


async function scanVideos(node) {
    const tokenObj = await safeGet(STORAGE_KEY_USER);
    // 取出真实token字符串
    const token = tokenObj?.[STORAGE_KEY_USER];

    // 1、无token
    if (!token) {
        return { msg: `token为空，请在插件弹窗填写token`, count: 0 }
    }
    // 2、JWT格式错误 || 已过期
    if (!checkJwtValid(token)) {
        return { msg: `token无效或已过期，请联系作者重新获取`, count: 0 }
    }


    let count = 0;
    const coverImages = (node || document).querySelectorAll('img[class*="cover-"]');
    for (const img of coverImages) {
        if (await createDownloadVideoLink(img)) {
            count++;
        }
    }
    return { msg: `刚刚成功处理了${count}条视频` }
}


// base64url解码
function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(atob(str).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

/** 前端校验token是否有效/过期 */
function checkJwtValid(jwtStr) {
    const arr = jwtStr.split('.');
    if (arr.length !== 3) return false;
    try {
        const payload = JSON.parse(base64UrlDecode(arr[1]));
        const now = Date.now() / 1000;
        // 过期判断
        if (payload.exp < now) return false;
        return true;
    } catch (e) {
        return false;
    }
}



async function createDownloadVideoLink(img) {

    // 已处理直接返回，防重复渲染按钮
    if (img.dataset.originHandled === '1') return 1;
    const key = getKeyFromUrl(img.src);

    if (key != null) {
        const button = document.createElement('button');
        button.style.cssText = `
        display: inline-block;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        color: green;
        position:absolute;
        top:0;
    `;

        // 安全读取原图信息
        const res = await safeGet(STORAGE_KEY_VID);
        const bucket = res.raw_video_bucket || {};
        const data = bucket[key];
        const isExsitRaw = data && data.vid;
        button.innerText = isExsitRaw ? '下载原视频' : '处理失败';
        button.style.zIndex = isExsitRaw ? 999 : 1;
        img.dataset.originHandled = isExsitRaw ? '1' : '0';
        if (!isExsitRaw) {
            button.style.color = 'red';
        }
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isExsitRaw) {
                button.disabled = true;
                button.innerText = '下载中...';

                const videoSourceUrl = await getUrlByVid(data.vid);

                chrome.runtime.sendMessage({
                    action: "downloadImage",
                    url: videoSourceUrl,
                    filename: `${data.vid}-无水印视频.mp4`
                });
                setTimeout(() => {
                    button.innerText = '下载原视频';
                    button.disabled = false;
                }, 4000);
            }
        });

        img.after(button);
        return isExsitRaw;
    }

    return 0;
}

async function getUrlByVid(vid) {
    const url = 'https://www.doubao.com/samantha/media/get_play_info?version_code=20800&language=zh-CN&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=&pc_version=2.51.7&region=&sys_region=&samantha_web=1&use-olympus-account=1&web_tab_id=';

    try {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'origin': 'https://www.doubao.com',
            },
            body: JSON.stringify({ key: vid }),
        });

        let result = await response.json();

        if (!result || !result.data) {
            console.log('API failed');
            console.log(result);

            return false;
        }

        let main_url = await result.data.original_media_info.main_url;

        return main_url;
    } catch (e) {
        console.error('获取视频播放信息失败:', e);

        return null;
    }
}


async function createDownloadLink(img) {

    // 已处理直接返回，防重复渲染按钮
    if (img.dataset.originHandled === '1') return 1;
    const key = img.dataset.trackKey ? normalizeKey(img.dataset.trackKey) : null;

    if (key != null) {
        const button = document.createElement('button');
        button.style.cssText = `
        display: inline-block;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        color: green;
        position:absolute;
        top:0;
    `;

        // 安全读取原图信息
        const res = await safeGet(STORAGE_KEY_IMG);
        const bucket = res.raw_image_bucket || {};
        const data = bucket[key];
        const isExsitRaw = data && data.image_ori_raw && data.gen_params;
        button.innerText = isExsitRaw ? '下载原图' : '处理失败';
        button.style.zIndex = isExsitRaw ? 999 : 1;
        img.dataset.originHandled = isExsitRaw ? '1' : '0';
        if (!isExsitRaw) {
            button.style.color = 'red';
        }
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isExsitRaw) {
                button.disabled = true;
                button.innerText = '下载中...';
                chrome.runtime.sendMessage({
                    action: "downloadImage",
                    url: data.image_ori_raw.url,
                    filename: `${data.gen_params.prompt}-无水印原图.png`
                });
                setTimeout(() => {
                    button.innerText = '下载原图';
                    button.disabled = false;
                }, 4000);
            }
        });

        img.closest('picture')?.after(button);
        img.onload = null;

        return isExsitRaw;
    } else {
        // 占位图延时重试
        img.onload = () => {
            setTimeout(() => createDownloadLink(img), 400);
        };
        return 1;
    }
}

//=====================【新增】动态监听DOM新增图片（自动生成下载按钮） =====================
const imgObserver = new MutationObserver(mutList => {
    mutList.forEach(mut => {
        mut.addedNodes.forEach(node => {
            if (node.querySelectorAll) {
                setTimeout(() => {
                    scanImages(node);
                    scanVideos(node);
                }, 300);
            }
        });
    });
});
// DOM树就绪后再监听body
document.addEventListener("DOMContentLoaded", () => {
    imgObserver.observe(document.body, { childList: true, subtree: true });
})