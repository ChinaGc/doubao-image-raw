const input = document.getElementById('tokenInput');
const scanBtn = document.getElementById('scanBtn');
const statusEl = document.getElementById('status');
const vx = document.getElementById('vx');
const expDateEl = document.getElementById('expDate');

const STORAGE_KEY = 'user_token';
const CONFIG_KEY = 'remoteConfig';


(async function init() {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    if (res[STORAGE_KEY]) {
        input.value = res[STORAGE_KEY];
        setStatus('激活码已加载，可直接操作');
        refreshExpView(input.value);
    } else {
        setStatus('请输入激活码', 'red');
        refreshExpView("");
    }

    let jsonData = await getJsonData();
    // 兼容逻辑：无jsonData / showVx 明确为 false → 隐藏；其余情况正常展示 TG版专属
    // if (jsonData && jsonData.showVx !== false && jsonData.vx) {
    //     vx.innerHTML = `作者微信号：<b>${jsonData.vx}</b>`;
    //     vx.style.display = 'block';
    // } else {
    //     vx.style.display = 'none';
    // }
    if (jsonData && jsonData.vx) {
        vx.innerHTML = `作者微信号：<b>${jsonData.vx}</b>`;
        vx.style.display = 'block';
    } else {
        vx.style.display = 'none';
    }
})();




// 固定格式 yyyy-mm-dd
function secToDate(sec) {
    const d = new Date(sec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function refreshExpView(token) {
    if (!token) {
        expDateEl.textContent = "未填入激活码";
        expDateEl.style.color = "#999";
        return;
    }
    const expSec = decodeExp(token);
    const nowSec = Date.now() / 1000;
    if (!expSec) {
        expDateEl.textContent = "激活码格式错误";
        expDateEl.style.color = "red";
    } else if (expSec < nowSec) {
        expDateEl.textContent = `已过期｜到期：${secToDate(expSec)}`;
        expDateEl.style.color = "red";
    } else {
        expDateEl.textContent = `有效｜到期：${secToDate(expSec)}`;
        expDateEl.style.color = "#099441";
    }
}

function setStatus(text, color = '#666') {
    statusEl.innerHTML = text;
    statusEl.style.color = color;
}

// 输入实时检测
input.oninput = () => {
    refreshExpView(input.value.trim());
};


scanBtn.onclick = async () => {
    const token = input.value.trim();
    if (!token) {
        setStatus('激活码不能为空，请输入后再操作', 'red');
        input.focus();
        return;
    }

    scanBtn.disabled = true;

    // 第一步：判断本地是否已存在该Token，存在则直接放行
    const localData = await chrome.storage.local.get(STORAGE_KEY);
    if (localData[STORAGE_KEY] === token) {
        setStatus('激活码已生效，开始处理...');
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tab.id, { action: 'scanImages', token: token }, (response) => {
                scanBtn.disabled = false;
                if (chrome.runtime.lastError) {
                    setStatus('请刷新页面后重试', 'red');
                    return;
                }
                const msg = `${response.r.msg}<br/>${response.vr.msg}`;
                setStatus(msg, 'green');
            });
        } catch (err) {
            scanBtn.disabled = false;
            console.error(err);
            setStatus('处理失败，请重试', 'red');
        }
        return;
    }

    // 第二步：本地无记录 → 先校验Token格式+有效期，拦截脏数据
    setStatus('校验激活码有效性...');
    if (!checkTokenValid(token)) {
        setStatus('激活码格式错误或已过期', 'red');
        scanBtn.disabled = false;
        return;
    }

    // 第三步：Token合法 → 查GitLab是否已被使用
    setStatus('校验激活码使用记录...');
    const { list: usedList, sha } = await getUsedTokenFromGitLab();
    if (usedList.includes(token)) {
        setStatus('该激活码已被使用，无法继续操作', 'red');
        scanBtn.disabled = false;
        return;
    }

    // 第四步：未使用 → 登记到GitLab
    setStatus('登记激活码...');
    usedList.push(token);
    const addSuccess = await addTokenToGitLab(usedList, sha);
    if (!addSuccess) {
        setStatus('登记激活码失败，请稍后重试', 'red');
        scanBtn.disabled = false;
        return;
    }

    // 第五步：写入本地存储，刷新有效期展示
    setStatus('激活码保存成功，开始处理...');
    await chrome.storage.local.set({ [STORAGE_KEY]: token });
    refreshExpView(token);

    // 原有业务逻辑
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: 'scanImages', token: token }, (response) => {
            scanBtn.disabled = false;
            if (chrome.runtime.lastError) {
                setStatus('请刷新页面后重试', 'red');
                return;
            }
            const msg = `${response.r.msg}<br/>${response.vr.msg}`;
            setStatus(msg, 'green');
        });
    } catch (err) {
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

const SEC_KEY = 2789451632;
const PRE_FIX = "sdf@_k9";
const SUF_FIX = "&23z_pq";
const SEP = "|";
const CHECK_LEN = 8;
const SALT = "myTokenSalt2026@gitlab"; // 和生成端盐值完全一致

// 同生成端哈希算法
function strongHash(input, salt, len = CHECK_LEN) {
    let str = input + salt;
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    let res = "";
    let val = Math.abs(hash).toString(16);
    while (val.length < len) val += val;
    for (let i = 0; i < len; i++) {
        res += chars[val.charCodeAt(i) % chars.length];
    }
    return res;
}

/**
 * 解密 + 完整性强校验
 * @param {string} token 激活码
 * @returns {number} 合法返回过期时间戳，非法返回 NaN
 */
function decodeExp(token) {
    try {
        // 1. Base64 解码
        const raw = atob(token);

        // 2. 强制校验前后固定标记（篡改头尾直接失败）
        if (!raw.startsWith(PRE_FIX) || !raw.endsWith(SUF_FIX)) {
            return NaN;
        }

        // 3. 裁剪固定前缀后缀
        let body = raw.slice(PRE_FIX.length);
        body = body.slice(0, body.length - SUF_FIX.length);

        // 4. 拆分 主体内容 + 校验码
        const bodyArr = body.split(SEP);
        // 格式固定：主体三段 + 校验码 → 数组长度必须 = 4
        if (bodyArr.length !== 4) {
            return NaN;
        }

        const part1 = bodyArr[0];
        const part2 = bodyArr[1];
        const part3 = bodyArr[2];
        const inputCheck = bodyArr[3];

        // 5. 校验码长度强制校验
        if (inputCheck.length !== CHECK_LEN) {
            return NaN;
        }

        // 6. 重组原始主体，重新计算哈希比对
        const innerBody = `${part1}${SEP}${part2}${SEP}${part3}`;
        const realCheck = strongHash(innerBody, SALT, CHECK_LEN);
        if (inputCheck !== realCheck) {
            return NaN;
        }

        // 7. 解析过期时间
        const cipherNum = Number(part1);
        if (isNaN(cipherNum)) {
            return NaN;
        }
        return cipherNum ^ SEC_KEY;
    } catch (e) {
        return NaN;
    }
}

/**
 * 校验Token是否有效（格式 + 未过期）
 * @param {string} token 激活码
 * @returns {boolean}
 */
function checkTokenValid(token) {
    const expTime = decodeExp(token);
    if (isNaN(expTime)) return false;
    const now = Math.floor(Date.now() / 1000);
    return expTime > now;
}


// ========== 请手动修改以下配置 ==========
const GITLAB_HOST = "https://gitlab.xiaoman999.com";  // 你的自建GitLab地址
const PROJECT_PATH = "xiaoman/doubao-tokens";     // 用户名/仓库名
const PRIVATE_TOKEN = "glpat-YKG8QC_YGaEJxDevPL2p";    // 访问令牌
const FILE_PATH = "used_tokens.json";          // 目标文件
const BRANCH = "main";                         // 仓库分支 main / master
// ======================================

/**
 * 读取：GitLab 返回 content 固定 Base64，必须解码
 * @returns { { list: string[], sha: string } }
 */
async function getUsedTokenFromGitLab() {
    try {
        const encodePath = encodeURIComponent(PROJECT_PATH);
        const url = `${GITLAB_HOST}/api/v4/projects/${encodePath}/repository/files/${encodeURIComponent(FILE_PATH)}?ref=${BRANCH}`;

        const res = await fetch(url, {
            headers: {
                "PRIVATE-TOKEN": PRIVATE_TOKEN
            }
        });

        if (!res.ok) {
            console.error("读取GitLab文件失败", res.status);
            return { list: [], sha: "" };
        }

        const data = await res.json();
        // GitLab 强制返回 Base64，这里必须解码
        const rawStr = atob(data.content);
        const list = JSON.parse(rawStr);
        return {
            list: Array.isArray(list) ? list : [],
            sha: data.commit_id
        };
    } catch (e) {
        console.error("读取GitLab异常", e);
        return { list: [], sha: "" };
    }
}

/**
 * 写入：直接传 JSON 原文，不再做 Base64 编码
 * @param {string[]} tokenList 最新列表
 * @param {string} fileSha 文件sha值
 * @returns {boolean} 是否成功
 */
async function addTokenToGitLab(tokenList, fileSha) {
    if (!fileSha) return false;
    try {
        const encodePath = encodeURIComponent(PROJECT_PATH);
        const url = `${GITLAB_HOST}/api/v4/projects/${encodePath}/repository/files/${encodeURIComponent(FILE_PATH)}`;

        // 直接转为普通 JSON 字符串，不做 btoa
        const content = JSON.stringify(tokenList);

        const res = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "PRIVATE-TOKEN": PRIVATE_TOKEN
            },
            body: JSON.stringify({
                branch: BRANCH,
                content: content,
                commit_message: "add new used token",
                sha: fileSha
            })
        });

        return res.ok;
    } catch (e) {
        console.error("写入GitLab异常", e);
        return false;
    }
}