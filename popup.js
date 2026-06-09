const input = document.getElementById('tokenInput');
const scanBtn = document.getElementById('scanBtn');
const statusEl = document.getElementById('status');
const vx = document.getElementById('vx');
const expDateEl = document.getElementById('expDate');

const STORAGE_KEY = 'user_token';
const CONFIG_KEY = 'remoteConfig';

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
    // ========== 核心改造：AES解密 XMToken 密文 ==========
    XM_TOKEN = jsonData.xmToken;
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

    // 第三步：Token合法 → 查XM是否已被使用
    setStatus('校验激活码使用记录...');
    const { list: usedList } = await getUsedTokenFromXM();
    if (usedList.includes(getTokenSuffix(token))) {
        setStatus('该激活码已被使用，无法继续操作', 'red');
        scanBtn.disabled = false;
        return;
    }

    // 第四步：未使用 → 登记到XM
    setStatus('登记激活码...');
    const addSuccess = await addTokenToXM(token);
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
const XM_HOST = "https://www.xiaoman999.com/hb-web-app";  // 你的自建XM地址
// 全局缓存 XM 密钥（动态从接口获取）
let XM_TOKEN = "";
// 读取 XM 文件（使用动态密钥）
async function getUsedTokenFromXM() {
    if (!XM_TOKEN) {
        console.warn("未获取到 XM 访问令牌");
        return { list: [], sha: "" };
    }
    try {
        const url = `${XM_HOST}/queryWishBookList`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Token": XM_TOKEN
            },
            body: `currentPage=1&pageSize=100`
        });
        if (!res.ok) {
            console.error("读取GitLab文件失败", res.status);
            return { list: [] };
        }
        const r = await res.json();
        const rawList = r.data;
        const signList = rawList.map(item => item.title || "");
        return { list: signList };
    } catch (e) {
        console.error("读取XM异常", e);
        return { list: [] };
    }
}

// 写入 XM 文件（使用动态密钥）
async function addTokenToXM(token) {
    if (!XM_TOKEN) return false;
    try {
        const url = `${XM_HOST}/addWishBookList`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Token": XM_TOKEN
            },
            body: `title=${getTokenSuffix(token)}`
        });
        const r = await res.json();
        return res.ok && r.success;
    } catch (e) {
        console.error("写入XM异常", e);
        return false;
    }
}


/**
 * 截取字符串最后20位
 * @param {string} str 原始token
 * @returns {string} 最后20位字符
 */
function getTokenSuffix(str) {
    if (!str) return '';
    const len = str.length;
    return len > 20 ? str.slice(-20) : str;
}

