import { test, expect } from '@playwright/test';

test.describe('Party Hub and Flow', () => {
  test('should show hub and allow choosing Imposter', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByText('Romish Party Games')).toBeVisible();
    
    // Check game cards
    await expect(page.getByText('IMPOSTER')).toBeVisible();
    await expect(page.getByText('REMI')).toBeVisible();
    await expect(page.getByText('COMING SOON')).toHaveCount(2);

    // Click Imposter
    await page.getByTestId('game-imposter').click();
    await expect(page.getByText('Agent Handle')).toBeVisible();
    await expect(page.getByText('Back to Hub')).toBeVisible();
  });

  test('should allow leader to manage settings and non-leader to see them', async ({ page, browser }) => {
    // 1. Leader Page
    const leaderPage = page; // Use default page as leader
    await leaderPage.goto('http://localhost:3000');
    await leaderPage.getByTestId('game-imposter').click();
    await leaderPage.getByTestId('input-name').fill('Leader');
    await leaderPage.getByTestId('input-name').press('Enter');
    
    // Wait for navigation and get code from display
    await expect(leaderPage).toHaveURL(/\/party\/.+/, { timeout: 15000 });
    const displayCode = leaderPage.getByTestId('display-code');
    await expect(displayCode).toBeVisible({ timeout: 15000 });
    const code = (await displayCode.textContent())?.trim() || '';
    expect(code).toHaveLength(6);
    
    // 2. Joiner Page
    const joinerContext = await browser.newContext();
    const joinerPage = await joinerContext.newPage();
    await joinerPage.goto('http://localhost:3000');
    await joinerPage.getByTestId('game-imposter').click();
    await joinerPage.getByTestId('input-name').fill('Joiner');
    await joinerPage.getByTestId('input-code').fill(code);
    await joinerPage.getByTestId('input-code').press('Enter');
    
    // Check if both see each other
    await expect(leaderPage.getByTestId('player-list')).toContainText('Joiner', { timeout: 15000 });
    await expect(joinerPage.getByTestId('player-list')).toContainText('Leader', { timeout: 15000 });

    // 3. Leader updates settings
    await expect(leaderPage.getByTestId('leader-controls')).toBeVisible();
    await leaderPage.getByTestId('tab-manage').click();
    const slider = leaderPage.getByTestId('slider-max-players');
    await slider.fill('5');
    await leaderPage.getByTestId('btn-save-settings').click();

    // 4. Verify update on both
    await expect(leaderPage.getByText('5 Agents')).toBeVisible();
    await expect(joinerPage.getByText('5 Agents')).toBeVisible();

    // 5. Leave flow
    await joinerPage.getByTestId('btn-leave').click();
    await expect(joinerPage).toHaveURL(/.*\//);
    
    // Switch leader back to lobby to verify joiner left
    await leaderPage.getByTestId('tab-lobby').click();
    await expect(leaderPage.getByTestId('player-list')).not.toContainText('Joiner');

    await joinerContext.close();
  });

  test('should allow leader to disband party', async ({ page, browser }) => {
    // 1. Leader
    await page.goto('http://localhost:3000');
    await page.getByTestId('game-imposter').click();
    await page.getByTestId('input-name').fill('Leader');
    await page.getByTestId('input-name').press('Enter');
    await expect(page).toHaveURL(/\/party\/.+/);
    const code = (await page.getByTestId('display-code').textContent())?.trim() || '';
    expect(code).toHaveLength(6);

    // 2. Joiner
    const joinerContext = await browser.newContext();
    const joinerPage = await joinerContext.newPage();
    await joinerPage.goto('http://localhost:3000');
    await joinerPage.getByTestId('game-imposter').click();
    await joinerPage.getByTestId('input-name').fill('Joiner');
    await joinerPage.getByTestId('input-code').fill(code);
    await joinerPage.getByTestId('input-code').press('Enter');

    // 3. Leader Disbands
    await expect(page.getByTestId('leader-controls')).toBeVisible();
    await page.getByTestId('tab-manage').click();
    await page.getByTestId('btn-disband').click();

    // 4. Both back to hub
    await expect(page).toHaveURL(/.*\//, { timeout: 15000 });
    await expect(joinerPage).toHaveURL(/.*\//);
    
    await joinerContext.close();
  });
});
