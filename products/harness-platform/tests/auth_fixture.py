"""Synthetic credentials for tests whose subject is already-signed-in product behavior."""
def email_opted_out(store, login):
    with store._write() as db:
        db.execute("""INSERT OR IGNORE INTO access_contacts(actor,email,email_login,verified)
                SELECT actor_id,?,0,1 FROM identity_accounts WHERE login=?""",
                   (login if "@" in login else login+"@example.test", login))


def service_token(client, login, password):
    return client.app.state.identity.login(login, password)


class BrowserCodes:
    """Capture one-time codes from the real application in a synthetic inbox."""

    def __init__(self, test, root):
        import base64
        import time
        from unittest.mock import patch

        from cryptography.fernet import Fernet
        from cryptography.hazmat.primitives.hashes import SHA1
        from cryptography.hazmat.primitives.twofactor.hotp import HOTP

        from platform_core.account_access import AccountAccess

        self.inbox = {}
        self.seeds = {}
        self.offset = 0
        self.clock = lambda: time.time() + self.offset
        self.totp = lambda seed: HOTP(base64.b32decode(seed), 6, SHA1()).generate(int(self.clock()) // 30).decode()
        key = root / 'fixture-auth.key'
        key.write_bytes(Fernet.generate_key())
        init = AccountAccess.__init__

        def configured(access, store, *args, **kwargs):
            init(access, store, mail=self.inbox.__setitem__, keyfile=key, clock=self.clock)

        test.enterContext(patch.object(AccountAccess, '__init__', configured))

    async def email(self, page, address):
        from playwright.async_api import expect

        await expect(page.get_by_role('heading', name='Проверьте почту')).to_be_visible()
        await page.get_by_label('Код из письма', exact=True).fill(self.inbox.pop(address))
        await page.get_by_role('button', name='Продолжить').click()
        self.offset += 61

    async def application(self, page, login):
        field = page.get_by_label('Код из приложения', exact=True)
        await field.wait_for()
        if login not in self.seeds:
            self.seeds[login] = await page.locator('code').inner_text()
        await field.fill(self.totp(self.seeds[login]))
        await page.get_by_role('button', name='Продолжить').click()
        self.offset += 30

    async def sign_in(self, page, login, password, *, address=None, admin=False, remember=False):
        await page.goto('/login')
        await page.get_by_label('Логин', exact=True).fill(login)
        await page.get_by_label('Пароль', exact=True).fill(password)
        if remember:
            await page.get_by_role('dialog').get_by_label('Запомнить меня', exact=True).check()
        await page.get_by_role('dialog').get_by_role('button', name='Войти', exact=True).click()
        if address:
            await self.email(page, address)
        if admin:
            await self.application(page, login)
        await page.locator('body[data-mode="member"]').wait_for()
