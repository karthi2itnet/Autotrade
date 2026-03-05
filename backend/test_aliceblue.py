import asyncio
import sys

# Add backend directory to path so we can import app modules
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.brokers import aliceblue
from app.services import option_chain

async def main():
    if len(sys.argv) < 4:
        print("Usage: python test_aliceblue.py <USER_ID> <API_KEY> <TOTP>")
        sys.exit(1)

    user_id = sys.argv[1]
    api_key = sys.argv[2]
    totp = sys.argv[3]

    print(f"[*] Attempting to connect Alice Blue for user: {user_id}")
    try:
        result = await aliceblue.connect(user_id=user_id, api_key=api_key, twofa=totp)
        print("[+] Connect successful!")
        print("    Result:", result)
    except Exception as e:
        print("[-] Connect failed:", e)
        sys.exit(1)

    # Test getting Spot LTP
    print("\n[*] Fetching NIFTY Spot LTP...")
    try:
        spot = await aliceblue.get_ltp("NSE", "Nifty 50")
        print(f"[+] Spot LTP: {spot}")
    except Exception as e:
        print("[-] Spot LTP fetch failed:", e)

    # Test Strike Set API
    print("\n[*] Fetching NIFTY Weekly Strikes...")
    try:
        # get_strike_set resolves the expiry, fetches spot, and calculates OTM/ATM/ITM strikes
        strikes = await option_chain.get_strike_set("NIFTY", "weekly", "aliceblue")
        print("\n[+] Strike fetching successful!")
        print(f"    ATM Strike: {strikes.atm}")
        print(f"    ATM CE LTP: {strikes.atm_ce_ltp}")
        print(f"    ATM PE LTP: {strikes.atm_pe_ltp}")
        print(f"    OTM1 CE: {strikes.otm1_ce} (LTP: {strikes.otm1_ce_ltp})")
        print(f"    ITM1 PE: {strikes.itm1_pe} (LTP: {strikes.itm1_pe_ltp})")
    except Exception as e:
        print("[-] Strike fetching failed:", e)
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
