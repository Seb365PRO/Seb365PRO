
import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1280, 'height': 720})

        # Get the absolute path to the index.html file
        file_path = os.path.abspath('index.html')

        # Go to the local file
        await page.goto(f'file://{file_path}')

        # Show the app container and hide the auth container
        await page.evaluate("""
            document.getElementById('app-container').classList.remove('hidden');
            document.getElementById('auth-container').classList.add('hidden');
        """)

        # Click the dashboard link inside the main nav to trigger rendering
        await page.click('#main-nav a[data-view="dashboard-view"]')

        # Wait for the dashboard view to be rendered
        await page.wait_for_selector('.content-view h2')

        # Take a screenshot of the dashboard
        element_handle = await page.query_selector('.content-view')
        if element_handle:
            await element_handle.screenshot(path='jules-scratch/verification/verification.png')
        else:
            print("Could not find the .content-view element to screenshot.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
