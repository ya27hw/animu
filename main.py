import argparse
import sys
from colorama import Fore, Style, init as colorama_init
from animu.config import get_config

# Initialize colorama
colorama_init(autoreset=True)

from animu.logger import setup_logging
setup_logging()

from animu.scheduler import scheduler
from animu import readiness


def initialize_runtime():
    """Authenticate PocketBase or explicitly record the local offline fallback."""
    try:
        from animu.database import db
        db.auth()
        readiness.mark_database(authenticated=True, offline_safe_mode=False)
    except Exception as exc:
        from animu.database import db
        offline_safe = db.offline_safe_mode_available()
        readiness.mark_database(authenticated=False, offline_safe_mode=offline_safe, status="offline_safe_mode" if offline_safe else "unavailable")
        print(f"Database readiness initialization failed: {type(exc).__name__}")

def run_once():
    scheduler.run_once()

def run_schedule():
    from animu import web
    initialize_runtime()
    web.start()
    scheduler.run_loop()

def run_web():
    from animu import web
    web.start_server()


def select_choice(choice_str: str):
    choice_str = choice_str.strip()
    if not choice_str.isdigit():
        print(f"{Fore.RED}Invalid command!{Style.RESET_ALL}")
        sys.exit(1)

    choice = int(choice_str)
    if choice == 1:
        run_once()
    elif choice == 2:
        run_schedule()
    elif choice == 3:
        run_web()
    elif choice == 4:
        print("Exiting...")
        sys.exit(0)
    else:
        print(f"{Fore.RED}Invalid command!{Style.RESET_ALL}")
        sys.exit(1)

def interactive_menu():
    print(f"1.\tRun the Anime Scheduler (once)")
    print(f"2.\tRun the Anime Scheduler")
    print(f"3.\tRun Web UI only")
    print(f"4.\tExit")
    
    try:
        choice = input("Enter your choice: ")
        select_choice(choice)
    except (KeyboardInterrupt, EOFError):
        print("\nExiting...")
        sys.exit(0)

def main():
    parser = argparse.ArgumentParser(description="Animu Python - Anime Auto-Downloader")
    parser.add_argument("--once", action="store_true", help="Run the scheduler once and exit")
    parser.add_argument("--schedule", action="store_true", help="Run the scheduler loop")
    parser.add_argument("--web", action="store_true", help="Run the Web UI only")
    parser.add_argument("choice", nargs="?", type=str, help="Direct choice index (1-4)")

    args = parser.parse_args()

    # Pre-load config to ensure it exists / works
    get_config()

    if args.choice:
        select_choice(args.choice)
    elif args.once:
        run_once()
    elif args.schedule:
        run_schedule()
    elif args.web:
        run_web()
    else:
        interactive_menu()

if __name__ == "__main__":
    main()
