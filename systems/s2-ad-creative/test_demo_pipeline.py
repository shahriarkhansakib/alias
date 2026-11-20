import urllib.request
import json

base = "http://127.0.0.1:8000"

def post(url, data, headers={}):
    req = urllib.request.Request(url, data=json.dumps(data).encode(), headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def get(url, headers={}):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

status, login_data = post(f"{base}/api/v1/auth/dev-login", {"email": "developer@example.com"})
print("Dev login:", status)
token = login_data["access_token"]
tenant_id = login_data["tenant"]["id"]
headers = {
    "Authorization": f"Bearer {token}",
    "X-Tenant-ID": tenant_id,
}

status, brief_data = get(f"{base}/api/v1/briefs/demo", headers=headers)
print("Demo brief:", status)

status, saved_brief = post(f"{base}/api/v1/briefs", brief_data, headers=headers)
print("Save brief:", status, str(saved_brief)[:200])
brief_id = saved_brief["id"] if isinstance(saved_brief, dict) else None

status, strat = post(f"{base}/api/v1/strategies/generate", {"brief_id": brief_id}, headers=headers)
print("Generate strategy:", status, str(strat)[:200])
strategy_id = strat.get("strategy_id") if isinstance(strat, dict) else None

status, bg = post(f"{base}/api/v1/backgrounds/generate", {"strategy_id": strategy_id, "platform": "instagram"}, headers=headers)
print("Generate background:", status, str(bg)[:300])
background_id = bg.get("id") if isinstance(bg, dict) else None

status, comp = post(f"{base}/api/v1/composites/generate", {"background_id": background_id}, headers=headers)
print("Generate composite:", status, str(comp)[:300])
composite_id = comp.get("id") if isinstance(comp, dict) else None

status, final_ad = post(f"{base}/api/v1/final-ads/generate", {"composite_id": composite_id}, headers=headers)
print("Generate final ad:", status, str(final_ad)[:300])


