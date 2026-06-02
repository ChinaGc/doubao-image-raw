const STORAGE_KEY_IMG = "raw_image_bucket";
const STORAGE_KEY_VID = "raw_video_bucket";
console.log("content start");
const script = document.createElement("script");
script.src = chrome.runtime.getURL("inject.js");
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();

function getKeyFromUrl(url) {
    try {
        const urlObj = new URL(url, location.origin);
        return urlObj.pathname
    } catch {
        return url
    }
}

async function saveImages(images) {
    if (!Object.keys(images).length) {
        return
    }
    const storage = await chrome.storage.local.get(STORAGE_KEY_IMG);
    const bucket = storage[STORAGE_KEY_IMG] || {};
    Object.assign(bucket, images);
    await chrome.storage.local.set({
        [STORAGE_KEY_IMG]: bucket
    })
}

async function saveVideos(videos) {
    if (!Object.keys(videos).length) {
        return
    }
    const storage = await chrome.storage.local.get(STORAGE_KEY_VID);
    const bucket = storage[STORAGE_KEY_VID] || {};
    Object.assign(bucket, videos);
    await chrome.storage.local.set({
        [STORAGE_KEY_VID]: bucket
    })
}

async function parseChainSingle(jsonData) {
    if (!Object.hasOwn(jsonData, "downlink_body")) {
        return
    }
    const imageBucket = {};
    const videoBucket = {};
    const messages = jsonData?.downlink_body?.pull_singe_chain_downlink_body?.messages || [];
    for (const message of messages) {
        if (message.user_type !== 2) {
            continue
        }
        if (!message.content_block) {
            continue
        }
        const contentBlock = message.content_block;
        if (Array.isArray(contentBlock)) {
            const creations = contentBlock?.[1]?.content?.creation_block?.creations;
            if (!Array.isArray(creations)) {
                continue
            }
            for (const item of creations) {
                if (item.type === 1 && item.image) {
                    const imageKey = item.image.key
                    imageBucket[imageKey] = item.image
                } else if (item.type === 2 && item.video) {
                    const vid = item.video.vid;
                    videoBucket[vid] = item.video
                }
            }
        }
    }
    await saveImages(imageBucket);
    await saveVideos(videoBucket);
    console.log("图片数量:", Object.keys(imageBucket).length);
    console.log("视频数量:", Object.keys(videoBucket).length);
}

window.addEventListener("message", async (event) => {
    if (event.source !== window) {
        return
    }
    const data = event.data;
    if (data.source !== "doubao-image-raw") {
        return
    }
    try {
        const jsonData = JSON.parse(data.body);
        if (data.api.includes("/im/chain/single")) {
            await parseChainSingle(jsonData)
        }
    } catch (e) {
        console.error("解析失败", e)
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scanImages') {
        const count = handleImages();
        sendResponse({
            count
        })
    }
    return true
});


function handleImages() {
    console.log("handleImages")
    let count = 0;
    const images = document.querySelectorAll('img[loading="lazy"][alt="image"][class*="image-"]');
    images.forEach(img => {
        createDownloadLink(img);
        count++
    });
    return count
}

function normalizeKey(trackKey) {
    // 找到最后一个 _ 出现的位置，然后取后面的部分
    const parts = trackKey.split('_');
    if (parts.length >= 3) {
        // 拼接最后两段及之后的内容（假设前两段是ID）
        return parts.slice(2).join('_');
    }
    return trackKey; // 兼容老数据
}



function createDownloadLink(img) {
    const key = normalizeKey(img.dataset.trackKey);

    //防止重复处理
    if (img.dataset.originHandled) return;

    // 创建 a 标签
    const button = document.createElement('button');

    button.style.cssText = `
        display: inline-block;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        text-decoration: none;
        color: #333;
        position:absolute;
        top:0;
    `;

    // 从 storage 获取原图地址和文件名

    chrome.storage.local.get(STORAGE_KEY_IMG, (res) => {
        const bucket = res.raw_image_bucket || {};
        const data = bucket[key];

        if (data && data.image_ori_raw && data.gen_params) {
            button.innerText = '下载原图';
            // 插入到 img 后
            img.closest('picture')?.after(button);
        } else {
            // 如果没有对应原图，暂时指向当前img src
            button.innerText = '处理失败';
        }

        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (data && data.image_ori_raw && data.gen_params) {
                chrome.runtime.sendMessage({
                    action: "downloadImage",
                    url: data.image_ori_raw.url,
                    filename: `${data.gen_params.prompt}-无水印原图.png`
                }, (response) => {
                    button.innerText = '下载成功';
                    console.log(response);
                });

            } else {
                // 如果没有对应原图，暂时指向当前img src
                button.innerText = '处理失败';
            }
            img.dataset.originHandled = '1';
        });
    });

}