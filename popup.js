const input = document.getElementById('tokenInput');
const scanBtn = document.getElementById('scanBtn');
const statusEl = document.getElementById('status');
const STORAGE_KEY = 'user_token';

// 状态更新函数
function setStatus(text, color = '#666') {
    statusEl.textContent = text;
    statusEl.style.color = color;
}

// 打开弹窗自动回显
chrome.storage.local.get(STORAGE_KEY, res => {
    if (res[STORAGE_KEY]) {
        input.value = res[STORAGE_KEY];
        setStatus('Token已加载，可直接操作');
    } else {
        setStatus('请输入Token', 'red');
    }
});

// 处理图片按钮
scanBtn.onclick = async () => {
    const token = input.value.trim();
    if (!token) {
        setStatus('Token不能为空，请输入后再操作', 'red');
        input.focus();
        return;
    }

    // 保存token
    chrome.storage.local.set({ [STORAGE_KEY]: token }, () => {
        setStatus('Token保存成功，开始处理...');
    });

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: 'scanImages', token: token }, (response) => {
            if (chrome.runtime.lastError) {
                setStatus('页面未加载插件脚本，请刷新页面重试', 'red');
                return;
            }
            setStatus(`处理完成，共处理 ${response.count} 张图片`, 'green');
        });
    } catch (err) {
        console.error(err);
        setStatus('处理失败，请重试', 'red');
    }
};