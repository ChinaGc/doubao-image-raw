const input = document.getElementById('tokenInput');
const scanBtn = document.getElementById('scanBtn');
const statusEl = document.getElementById('status');
const vx = document.getElementById('vx');
const expDateEl = document.getElementById('expDate');

// 和签发、content保持一致
const SEC_KEY = 2789451632;
const PRE_FIX = "sdf@_k9";
const SUF_FIX = "&23z_pq";

const STORAGE_KEY = 'user_token';
const CONFIG_KEY = 'remoteConfig';

// 解密函数
function decodeExp(token) {
    try {
        const raw = atob(token);
        let body = raw.slice(PRE_FIX.length);
        body = body.slice(0, body.length - SUF_FIX.length);
        const cipherNum = Number(body);
        if (isNaN(cipherNum)) return null;
        const realExp = cipherNum ^ SEC_KEY;
        // 合法时间戳范围：2025~2035年秒数，乱码算无效
        if(realExp < 1735660800 || realExp > 2079676800){
            return null;
        }
        return realExp;
    } catch {
        return null;
    }
}

// 固定格式 yyyy-mm-dd
function secToDate(sec) {
    const d = new Date(sec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
}

function refreshExpView(token) {
    if(!token){
        expDateEl.textContent = "未填入Token";
        expDateEl.style.color = "#999";
        return;
    }
    const expSec = decodeExp(token);
    const nowSec = Date.now()/1000;
    if(!expSec){
        expDateEl.textContent = "Token格式错误";
        expDateEl.style.color = "red";
    }else if(expSec < nowSec){
        expDateEl.textContent = `已过期｜到期：${secToDate(expSec)}`;
        expDateEl.style.color = "red";
    }else{
        expDateEl.textContent = `有效｜到期：${secToDate(expSec)}`;
        expDateEl.style.color = "#099441";
    }
}

function setStatus(text, color = '#666') {
    statusEl.innerHTML = text;
    statusEl.style.color = color;
}

(async function init() {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    if (res[STORAGE_KEY]) {
        input.value = res[STORAGE_KEY];
        setStatus('Token已加载，可直接操作');
        refreshExpView(input.value);
    } else {
        setStatus('请输入Token', 'red');
        refreshExpView("");
    }

    let jsonData = await getJsonData();
    if (jsonData?.vx) {
        vx.innerHTML = `作者微信号：<b>${jsonData.vx}</b>`;
    } else {
        vx.innerHTML = `作者微信号：获取失败`;
    }
})();

// 输入实时检测
input.oninput = ()=>{
    refreshExpView(input.value.trim());
};

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
    refreshExpView(token);

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: 'scanImages', token: token }, (response) => {
            scanBtn.disabled = false;
            if (chrome.runtime.lastError) {
                setStatus('请刷新页面后重试', 'red');
                return;
            }
            let imgMsg = response.r.msg;
            let vrMsg = response.vr.msg;
            let msg = `${imgMsg}<br/>${vrMsg}`;
            setStatus(msg, 'green');
        });
    } catch (err){
        scanBtn.disabled = false;
        console.error(err);
        setStatus('处理失败，请重试', 'red');
    }
};

async function getJsonData() {
    const url = 'https://www.xiaoman999.com/web/i.json'
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