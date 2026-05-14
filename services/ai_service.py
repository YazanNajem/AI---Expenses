import json
import requests

OLLAMA_URL = 'http://localhost:11434/api/generate'
MODEL_NAME = 'llama3.2'


def _call_ollama(prompt: str) -> str:
    try:
        resp = requests.post(OLLAMA_URL, json={
            'model': MODEL_NAME,
            'prompt': prompt,
            'stream': False
        }, timeout=60)
        resp.raise_for_status()
        return resp.json().get('response', '')
    except requests.ConnectionError:
        raise ConnectionError(
            'Cannot connect to Ollama. Ensure it is running: ollama serve'
        )
    except Exception as e:
        raise RuntimeError(f'Ollama error: {e}')


def _clean_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[1].rsplit('\n', 1)[0]
    return json.loads(raw)


def analyze_nl(text: str) -> dict:
    prompt = (
        'You are a financial expense parser. Extract purchase details from the text.\n'
        'Respond ONLY with raw JSON. No markdown, no code fences, no explanations.\n'
        'Example: {"item_name":"Gold Bar","amount":5000,"category":"Gold/Investments","is_asset":true}\n'
        'Example: {"item_name":"Groceries","amount":250,"category":"Food","is_asset":false}\n'
        'Category must be one of: Food, Transport, Utilities, Entertainment, Healthcare, Education, Clothing, Housing, Gold/Investments, Other\n'
        'is_asset: true only for investment assets (gold, real estate, stocks, crypto, silver). Otherwise false.\n\n'
        f'Text: {text}'
    )
    try:
        raw = _call_ollama(prompt)
        result = _clean_json(raw)
        if not isinstance(result.get('is_asset'), bool):
            result['is_asset'] = False
        return result
    except Exception as e:
        return {'error': str(e)}


def analyze_invoice(image_bytes: bytes) -> dict:
    return {'error': 'Image analysis is currently disabled in the local AI environment.'}


def get_chat_response(question: str, context: str) -> str:
    prompt = (
        "You are a financial assistant analyzing personal finance data.\n\n"
        "DATABASE CONTEXT:\n"
        f"{context}\n\n"
        "Answer the user's question concisely using only the data above. Be specific with numbers.\n"
        f"Question: {question}"
    )
    try:
        return _call_ollama(prompt)
    except Exception as e:
        return f'Error: {str(e)}'
