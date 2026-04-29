def format_output(value):
    return str(value)

def calculate_sum(numbers):
    return sum(numbers)

def filterEmpty(items):
    return [x for x in items if x]

def parseJson(raw):
    import json
    return json.loads(raw)

def normalize_path(raw_path):
    return raw_path.replace('\\', '/')

def read_config(config_path):
    return {}
