chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadImage') {
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
                return;
            }
            sendResponse({
                success: true,
                downloadId
            });
        });
        return true;
    }
});


// ========== 功能1：插件首次安装完成，刷新所有doubao标签页 ==========
chrome.runtime.onInstalled.addListener((details) => {
    // 仅首次安装触发，更新/重装不刷新
    if (details.reason === "install") {
        chrome.tabs.query({ url: "https://*.doubao.com/*" }, tabs => {
            tabs.forEach(tab => {
                if (tab.id) chrome.tabs.reload(tab.id);
            })
        })
    }
});

const STORAGE_KEY_IMG = 'raw_image_bucket';
const STORAGE_KEY_VID = 'raw_video_bucket';

chrome.runtime.onStartup.addListener(async () => {
    await chrome.storage.local.remove([
        STORAGE_KEY_IMG,
        STORAGE_KEY_VID
    ]);
    console.log('已清理上次缓存');
});