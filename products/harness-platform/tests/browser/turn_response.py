"""Read the terminal application result from the browser's actual turn response."""
import asyncio


async def observe_turns(page):
    results = asyncio.Queue()
    await page.expose_function("recordTestTurnResult", results.put_nowait)
    await page.add_init_script("""(() => {
        const original = window.fetch;
        window.fetch = async (...args) => {
            const response = await original.apply(window, args);
            if (new URL(response.url).pathname.endsWith('/turns')) {
                const copy = response.clone();
                void copy.text().then(text => {
                    let result;
                    if (copy.headers.get('Content-Type')?.startsWith('application/x-ndjson')) {
                        result = text.trim().split('\\n').map(line => JSON.parse(line)).findLast(frame => !frame.pending);
                    } else {
                        result = {status:copy.status, body:JSON.parse(text)};
                    }
                    return window.recordTestTurnResult(result);
                });
            }
            return response;
        };
    })()""")
    return results
