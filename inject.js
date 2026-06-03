(function () {
	const TARGET_APIS = ["/im/chain/single", "/chat/completion"];
	const oldOpen = XMLHttpRequest.prototype.open;
	const oldSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function (...args) {
		this._hookUrl = args[1];
		return oldOpen.apply(this, args)
	};
	XMLHttpRequest.prototype.send = function (...args) {
		this.addEventListener("load", () => {
			try {
				const url = this._hookUrl || "";
				const matched = TARGET_APIS.some(api => url.includes(api));
				if (!matched) {
					return
				}
				window.postMessage({
					source: "doubao-image-raw",
					api: url,
					body: this.responseText
				})
			} catch (e) {
				console.error(e)
			}
		});
		return oldSend.apply(this, args)
	}

	// inject.js 追加 fetch劫持【修改：只携带chat_ability才捕获响应】
	const originFetch = window.fetch;
	window.fetch = async function (input, init) {
		const url = typeof input === 'string' ? input : input.url;
		// 1. 非目标接口直接放行
		const isTargetApi = TARGET_APIS.some(api => url.includes(api));
		if (!isTargetApi) {
			return originFetch(input, init);
		}

		let needHook = false;
		// 解析POST请求body，查找chat_ability字段
		if (init && init.method?.toUpperCase() === "POST" && init.body) {
			try {
				let reqBodyStr = "";
				// 处理FormData/Blob等只处理json字符串
				if (typeof init.body === "string") {
					reqBodyStr = init.body;
				}
				const reqJson = JSON.parse(reqBodyStr);
				// 顶层存在chat_ability标记为需要劫持响应
				if (reqJson && reqJson.chat_ability) {
					needHook = true;
				}
			} catch {
				// json解析失败=非json参数，不需要捕获
				needHook = false;
			}
		}

		// 只有needHook为true才克隆响应、推送消息给content
		if (needHook) {
			const resp = await originFetch(input, init);
			const cloneResp = resp.clone();
			const text = await cloneResp.text();
			window.postMessage({
				source: "doubao-image-raw",
				api: url,
				body: text
			})
			return resp;
		}

		return originFetch(input, init);;
	};
})();