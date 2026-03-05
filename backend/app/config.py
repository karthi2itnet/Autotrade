from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Alice Blue (Ant API)
    aliceblue_user_id: str = ""
    aliceblue_api_key: str = ""

    zerodha_api_key: str = ""
    zerodha_api_secret: str = ""
    zerodha_client_id: str = ""
    zerodha_request_token: str = ""

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    database_url: str = "sqlite+aiosqlite:///./autotrade.db"
    env: str = "development"

    class Config:
        env_file = ".env"

settings = Settings()
