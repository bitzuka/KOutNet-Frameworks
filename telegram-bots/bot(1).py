import asyncio
import html
import time
import os
import logging
from pathlib import Path

from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart, Command, CommandObject
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.exceptions import TelegramAPIError, TelegramRetryAfter

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# SETTINGS-------------- 
BOT_TOKEN = os.getenv("BOT_TOKEN")           # bot token
ADMIN_CHAT_ID = os.getenv("ADMIN_CHAT_ID")   # chat ID where messages will be sent
ADMIN_USER_ID = os.getenv("ADMIN_USER_ID")   # who can use /ban and /unban
COOLDOWN = 10                                # seconds between messages from one user
ALBUM_WAIT = 1.5                             # seconds to collect all files of album
BANNED_FILE = Path("banned.txt")             # blacklist is stored here
#-----------------------

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("suggestion_bot")

if not BOT_TOKEN or not ADMIN_CHAT_ID:
    raise SystemExit("Set the BOT_TOKEN and ADMIN_CHAT_ID environment variables")
ADMIN_CHAT_ID = int(ADMIN_CHAT_ID)
ADMIN_USER_ID = int(ADMIN_USER_ID) if ADMIN_USER_ID else ADMIN_CHAT_ID

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()

dp.message.filter(F.chat.type == "private") #the bot works only in private chats

last_time:  dict[int, float] = {}                 # user_id - time of the last message
albums: dict[str, list[types.Message]] = {}       # media_group_id - collected messages
background_tasks: set[asyncio.Task] = set()       # keeps references to running tasks
send_lock = asyncio.Lock()                        # sends to the admin chat go one at a time


# blacklist------------------------
def load_banned() -> set[int]:
    if BANNED_FILE.exists():
        return {int(x) for x in BANNED_FILE.read_text().split() if x.lstrip("-").isdigit()}
    return set()

def save_banned() -> None:
    #atomic write
    tmp = BANNED_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(str(x) for x in sorted(banned)))
    os.replace(tmp, BANNED_FILE)

banned = load_banned()


# helpers---------------------------
async def tg_call(method, *args, retries: int = 3, **kwargs):
    """Calls a Telegram method and waits out flood limits (TelegramRetryAfter)"""
    for attempt in range(retries):
        try:
            return await method(*args, **kwargs)
        except TelegramRetryAfter as e:
            log.warning("Flood limit, waiting %s s", e.retry_after)
            if attempt == retries - 1:
                raise
            await asyncio.sleep(e.retry_after)


def build_header(user: types.User) -> str:
    if user.username:
        name = html.escape(user.username)
        who = f'<a href="https://t.me/{name}">@{name}</a>'
    else:
        who = f'<a href="tg://user?id={user.id}">{html.escape(user.full_name)}</a>'
    return (
        f"<b>From:</b> {who}\n"
        f"<b>ID:</b> <code>{user.id}</code> | <code>/ban {user.id}</code>"
    )

async def cleanup_loop() -> None:
    """removes old records from last_time so it doesn't grow forever"""
    while True:
        await asyncio.sleep(60)
        now = time.monotonic()
        for uid in [u for u, t in last_time.items() if now - t > COOLDOWN]:
            del last_time[uid]

async def process(messages: list[types.Message]) -> None:
    """Delivers one message (or album) to the admin chat"""
    first = messages[0]
    user = first.from_user
    ids = sorted(m.message_id for m in messages)
    reply = None
    
    async with send_lock:
        last = last_time.get(user.id)
        left = COOLDOWN - (time.monotonic() - last) if last is not None else 0
        if left > 0:
            reply = f"too fast, please wait {int(left) + 1} s"
        else: 
            try:
                await tg_call(bot.send_message, ADMIN_CHAT_ID, build_header(user))
                await tg_call(
                    bot.copy_messages,
                    chat_id=ADMIN_CHAT_ID,
                    from_chat_id=first.chat.id,
                    message_ids=ids,
                )
                last_time[user.id] = time.monotonic() #cooldown starts only after success
                reply = "your message has been sent successfully"
            except TelegramAPIError:
                log.exception("Failed to deliver message from user %s", user.id)
                reply = "An error occurred during transmission. Please try again later"
    
    if reply:
        try:
            await first.answer(reply)
        except TelegramAPIError:
            log.warning("could not reply to user %s", user.id)


async def flush_album(group_id: str) -> None:
    try:
        await asyncio.sleep(ALBUM_WAIT)
        messages = albums.pop(group_id, [])
        if messages:
            await process(messages)
    except Exception:
        log.exception("Album %s failed", group_id)
        albums.pop(group_id, None)


# handlers--------------------------------

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    await message.answer("Hello. Write or upload the file here you would like to send to the streamer")


@dp.message(Command("ban"), F.from_user.id == ADMIN_USER_ID)
async def cmd_ban(message: types.Message, command: CommandObject):
    if not command.args or not command.args.strip().isdigit():
        await message.answer("Usage: /ban USER_ID")
        return
    banned.add(int(command.args.strip()))
    save_banned()
    await message.answer(f"Banned: {command.args.strip()}")

@dp.message(Command("unban"), F.from_user.id == ADMIN_USER_ID)
async def cmd_unban(message: types.Message, command: CommandObject):
    if not command.args or not command.args.strip().isdigit():
        await message.answer("Usage: /unban USER_ID")
        return
    banned.discard(int(command.args.strip()))
    save_banned()
    await message.answer(f"Unbanned: {command.args.strip()}")


@dp.message()
async def handle_suggestion(message: types.Message):
    if message.from_user.id in banned:
        return #banned users are silently ignored

    group_id = message.media_group_id
    if group_id:
        if group_id in albums:
            albums[group_id].append(message)
        else:
            albums[group_id] = [message]
            task = asyncio.create_task(flush_album(group_id))
            background_tasks.add(task)
            task.add_done_callback(background_tasks.discard)
        return

    await process([message])

async def main():
    cleaner = asyncio.create_task(cleanup_loop())
    log.info("The bot has been launched and is ready for operation")
    try:
        await dp.start_polling(bot)
    finally:
        cleaner.cancel()


if __name__ == "__main__":
    asyncio.run(main())

