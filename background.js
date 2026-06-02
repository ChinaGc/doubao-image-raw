chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {
        if (request.action === "downloadImage") {
            chrome.downloads.download({
                url: request.url,
                filename: request.filename,
                saveAs: false
            }, function (downloadId) {
                if (chrome.runtime.lastError) {
                    console.error('下载失败:', chrome.runtime.lastError.message);
                } else {
                    console.log('下载开始，ID:', downloadId);
                    sendResponse({
                        downloadId
                    })
                }
            });
        }
    }
);