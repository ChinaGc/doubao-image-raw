chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {
        if (request.action === "downloadImage") {
            chrome.downloads.download({
                url: request.url,
                filename: request.filename,
                saveAs: false
            });
        }
    }
);