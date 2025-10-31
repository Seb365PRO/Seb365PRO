
import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        import os
        file_path = "file://" + os.path.abspath('index.html')
        await page.goto(file_path)

        # Wait for the auth container to be visible and then login
        await expect(page.locator("#auth-container")).to_be_visible(timeout=10000)
        await page.fill("#login-email", "test@test.com")
        await page.fill("#login-password", "123456")
        await page.click("button[type='submit']")

        # Now wait for the dashboard heading to be visible after login
        await expect(page.get_by_role("heading", name="Dashboard")).to_be_visible(timeout=15000)

        # Wait for the inventory table to be populated, which indicates data has loaded.
        await expect(page.locator("#inventory-status-table")).not_to_contain_text("Cargando...", timeout=20000)

        await asyncio.sleep(2) # a short pause to ensure rendering is complete

        # Take a screenshot
        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
