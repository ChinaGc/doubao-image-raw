const input = document.getElementById('tokenInput');
const scanBtn = document.getElementById('scanBtn');
const statusEl = document.getElementById('status');
const vx = document.getElementById('vx');

// 顶部统一定义所有存储KEY
const STORAGE_KEY = 'user_token';
const CONFIG_KEY = 'remoteConfig';

// 状态更新函数
function setStatus(text, color = '#666') {
    statusEl.innerHTML = text;
    statusEl.style.color = color;
}

// 初始化：拉取配置存storage + 回填token
(async function init() {

    // 回填token
    const res = await chrome.storage.local.get(STORAGE_KEY);
    if (res[STORAGE_KEY]) {
        input.value = res[STORAGE_KEY];
        setStatus('Token已加载，可直接操作');
    } else {
        setStatus('请输入Token', 'red');
    }

    let jsonData = await getJsonData();
    if (jsonData?.vx) {
        vx.innerHTML = `作者微信号：<b>${jsonData.vx}</b>`;
    } else {
        vx.innerHTML = `作者微信号：获取失败`;
    }

    // 使用常量KEY保存配置
    // if (jsonData) {
    //     await chrome.storage.local.set({ [CONFIG_KEY]: jsonData })
    // }

})();

// 按钮点击
scanBtn.onclick = async () => {
    const token = input.value.trim();
    if (!token) {
        setStatus('Token不能为空，请输入后再操作', 'red');
        input.focus();
        return;
    }

    scanBtn.disabled = true;
    setStatus('Token保存成功，开始处理...');
    await chrome.storage.local.set({ [STORAGE_KEY]: token });

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: 'scanImages', token: token }, (response) => {
            scanBtn.disabled = false;
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError);
                setStatus('请刷新页面后重试', 'red');
                return;
            }
            let imgMsg = response.r.msg;
            let vrMsg = response.vr.msg;
            let msg = `${imgMsg}<br/>${vrMsg}`;
            setStatus(msg, 'green');
        });
    } catch (err) {
        scanBtn.disabled = false;
        console.error(err);
        setStatus('处理失败，请重试', 'red');
    }
};

async function getJsonData() {
    const url = 'https://xiaoman99.oss-cn-hangzhou.aliyuncs.com/hb-web-admin/2026/06/03/aJrmtiRIr728DBU8tbQ7b11RYPxV8axC.json'
    try {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(resp.statusText)
        const data = await resp.json()
        return data
    } catch (err) {
        console.error('请求失败：', err)
        return null
    }
}