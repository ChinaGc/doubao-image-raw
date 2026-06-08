const input = document.getElementById('tokenInput');
const scanBtn = document.getElementById('scanBtn');
const statusEl = document.getElementById('status');
const vx = document.getElementById('vx');
const expDateEl = document.getElementById('expDate');

const STORAGE_KEY = 'user_token';
const CONFIG_KEY = 'remoteConfig';
// 全局缓存 GitLab 密钥（动态从接口获取）
let GITLAB_PRIVATE_TOKEN = "";

// ===================== AES 加密配置（自行替换为你的密钥/IV） =====================
// ===================== AES 解密配置 & 工具函数 =====================
// 64位十六进制 = 32字节(AES-256)，32位十六进制 = 16字节(IV)
const AES_KEY_HEX = "5f4dcc3b5aa765d61d8327deb882cf995f4dcc3b5aa765d61d8327deb882cf99";
const AES_IV_HEX = "1234567890abcdef1234567890abcdef";

/**
 * 十六进制字符串 → Uint8Array
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToUint8Array(hex) {
    const len = hex.length;
    const arr = new Uint8Array(len / 2);
    for (let i = 0; i < len; i += 2) {
        arr[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return arr;
}

/**
 * AES-256-CBC 解密 Base64 密文
 * @param {string} cipherBase64
 * @returns {string|null}
 */
async function aesDecrypt(cipherBase64) {
    try {
        // 转成标准字节数组
        const keyBytes = hexToUint8Array(AES_KEY_HEX);
        const ivBytes = hexToUint8Array(AES_IV_HEX);

        // 导入密钥
        const key = await crypto.subtle.importKey(
            "raw",
            keyBytes,
            { name: "AES-CBC", length: 256 },
            false,
            ["decrypt"]
        );

        // Base64 → 二进制
        const cipherBin = Uint8Array.from(
            atob(cipherBase64),
            c => c.charCodeAt(0)
        );

        // 解密
        const plainBin = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv: ivBytes },
            key,
            cipherBin
        );

        return new TextDecoder("utf-8").decode(plainBin);
    } catch (e) {
        console.error("AES解密失败：", e);
        return null;
    }
}

// =====================================================================
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
    // ========== 核心改造：AES解密 gitlabToken 密文 ==========
    if (jsonData && jsonData.gitlabToken) {
        const cipherText = jsonData.gitlabToken;
        const plainToken = await aesDecrypt(cipherText);
        GITLAB_PRIVATE_TOKEN = plainToken || "";
    } else {
        GITLAB_PRIVATE_TOKEN = "";
    }
})();


function secToDate(sec) {
    const d = new Date(sec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return atob(str);
}

/**
 * 仅解析过期时间
 */
function getTokenExp(token) {
    try {
        const arr = token.split('.');
        if (arr.length !== 2) {
            return null;
        }
        const payload = JSON.parse(
            base64UrlDecode(arr[0])
        );
        return payload.exp || null;
    } catch {
        return null;
    }
}

function refreshExpView(token) {

    if (!token) {
        expDateEl.textContent = "未填入激活码";
        expDateEl.style.color = "#999";
        return;
    }

    const expSec = getTokenExp(token);

    if (!expSec) {
        expDateEl.textContent = "激活码格式错误";
        expDateEl.style.color = "red";
        return;
    }

    const nowSec = Date.now() / 1000;
    if (expSec < nowSec) {
        expDateEl.textContent =
            `已过期｜到期：${secToDate(expSec)}`;
        expDateEl.style.color = "red";

    } else {
        expDateEl.textContent =
            `有效｜到期：${secToDate(expSec)}`;
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
    const checkResult = await checkTokenValid(token);
    if (!checkResult) {
        setStatus('激活码不合法或已过期', 'red');
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

//================== token验证部分 =====================
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJL3QC7MJ/jP/bsx6oeBQUkrq/guJ
Rrs4FFMs4wA/DouqzyBbWuLCCTrh17+txuncmcAe+rBJImjyffa7SdX3Hg==
-----END PUBLIC KEY-----`;

async function importPublicKey(pem) {
    const pemBody = pem
        .replace(
            '-----BEGIN PUBLIC KEY-----',
            ''
        )
        .replace(
            '-----END PUBLIC KEY-----',
            ''
        )
        .replace(/\s+/g, '');
    const binary = Uint8Array.from(
        atob(pemBody),
        c => c.charCodeAt(0)
    );
    return crypto.subtle.importKey(
        'spki',
        binary.buffer,
        {
            name: 'ECDSA',
            namedCurve: 'P-256'
        },
        false,
        ['verify']
    );
}

async function checkTokenValid(token) {
    try {
        if (!token) {
            return false;
        }
        const arr = token.split('.');
        if (arr.length !== 2) {
            return false;
        }
        const payloadPart = arr[0];
        const signPart = arr[1];
        const payloadStr =
            base64UrlDecode(payloadPart);
        const payload =
            JSON.parse(payloadStr);
        if (!payload.exp) {
            return false;
        }
        const now =
            Math.floor(Date.now() / 1000);
        if (payload.exp < now) {
            return false;
        }
        const publicKey =
            await importPublicKey(
                PUBLIC_KEY
            );
        const signature =
            Uint8Array.from(
                atob(
                    signPart
                        .replace(/-/g, '+')
                        .replace(/_/g, '/')
                ),
                c => c.charCodeAt(0)
            );
        return await crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: 'SHA-256'
            },
            publicKey,
            signature,
            new TextEncoder().encode(
                payloadStr
            )
        );
    } catch (e) {
        console.error(e);
        return false;
    }
}

// ========== 请手动修改以下配置 ==========
const GITLAB_HOST = "https://gitlab.xiaoman999.com";  // 你的自建GitLab地址
const PROJECT_PATH = "xiaoman/doubao-tokens";     // 用户名/仓库名
const FILE_PATH = "used_tokens.json";          // 目标文件
const BRANCH = "main";                         // 仓库分支 main / master


// 读取 GitLab 文件（使用动态密钥）
async function getUsedTokenFromGitLab() {
    if (!GITLAB_PRIVATE_TOKEN) {
        console.warn("未获取到 GitLab 访问令牌");
        return { list: [], sha: "" };
    }
    try {
        const encodePath = encodeURIComponent(PROJECT_PATH);
        const url = `${GITLAB_HOST}/api/v4/projects/${encodePath}/repository/files/${encodeURIComponent(FILE_PATH)}?ref=${BRANCH}`;
        const res = await fetch(url, {
            headers: {
                "PRIVATE-TOKEN": GITLAB_PRIVATE_TOKEN
            }
        });
        if (!res.ok) {
            console.error("读取GitLab文件失败", res.status);
            return { list: [], sha: "" };
        }
        const data = await res.json();
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

// 写入 GitLab 文件（使用动态密钥）
async function addTokenToGitLab(tokenList, fileSha) {
    if (!GITLAB_PRIVATE_TOKEN || !fileSha) return false;
    try {
        const encodePath = encodeURIComponent(PROJECT_PATH);
        const url = `${GITLAB_HOST}/api/v4/projects/${encodePath}/repository/files/${encodeURIComponent(FILE_PATH)}`;
        const content = JSON.stringify(tokenList);
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "PRIVATE-TOKEN": GITLAB_PRIVATE_TOKEN
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


