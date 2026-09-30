import asyncio, pathlib
from playwright.async_api import async_playwright
D=pathlib.Path(__file__).parent.resolve()
SHOTS=[('01-library','index.html#library'),('02-pack-detail','index.html#pack/pumpkin'),('03-request-a-pack','index.html?step=2#request'),('04-my-classroom','index.html#classroom'),('05-pricing','index.html#pricing')]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
        for name,url in SHOTS:
            await pg.goto((D/url.split('?')[0].split('#')[0]).as_uri()+url[len('index.html'):])
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=str(D/'screenshots'/f'{name}.png'),full_page=True)
            await pg.screenshot(path=str(D/'screenshots'/f'{name}-viewport.png'))
            print(name)
        await b.close()
asyncio.run(main())
