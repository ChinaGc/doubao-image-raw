(function() {
	const TARGET_APIS = ["/im/chain/single"];
	const oldOpen = XMLHttpRequest.prototype.open;
	const oldSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function(...args) {
		this._hookUrl = args[1];
		return oldOpen.apply(this, args)
	};
	XMLHttpRequest.prototype.send = function(...args) {
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
})();