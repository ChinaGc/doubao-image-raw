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

	// inject.js 追加 fetch劫持
	const originFetch = window.fetch;
	window.fetch = async function (input, init) {
		const url = typeof input === 'string' ? input : input.url;
		const resp = await originFetch(input, init);
		// 匹配目标接口
		const matched = TARGET_APIS.some(api => url.includes(api));
		if (!matched) {
			return
		}
		const cloneResp = resp.clone();
		const text = await cloneResp.text();
		// 和XHR共用同一套消息格式发给content
		window.postMessage({
			source: "doubao-image-raw",
			api: url,
			body: text
		})
		return resp;
	};
})();