/*! coi-serviceworker v0.1.7 | MIT License | https://github.com/gzuidhof/coi-serviceworker */
if (typeof window === "undefined") {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("fetch", (event) => {
        const { request } = event;
        if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
            return;
        }

        event.respondWith(
            fetch(request).then((response) => {
                if (response.status === 0) {
                    return response;
                }

                const newHeaders = new Headers(response.headers);
                newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
                newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders,
                });
            }).catch(e => {
                console.error(e);
            })
        );
    });
} else {
    (() => {
        const reloader = () => {
            console.log("Reloading page to activate COOP/COEP headers via Service Worker");
            window.location.reload();
        };

        // Register the service worker
        navigator.serviceWorker.register(window.document.currentScript.src).then((registration) => {
            registration.addEventListener("updatefound", () => {
                reloader();
            });

            if (registration.active && !navigator.serviceWorker.controller) {
                reloader();
            }
        }, (error) => {
            console.error("COOP/COEP Service Worker registration failed: ", error);
        });
    })();
}
