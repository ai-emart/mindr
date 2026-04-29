def process_data(raw_input):
    return raw_input.strip()

def load_from_file(file_path):
    with open(file_path) as f:
        return f.read()

def save_to_file(file_path, content):
    with open(file_path, 'w') as f:
        f.write(content)

def parse_csv_line(line):
    return line.split(',')

def validate_email(email_str):
    return '@' in email_str

class DataProcessor:
    def __init__(self, config):
        self.config = config

    def run_pipeline(self, data):
        return process_data(data)

    def get_results(self):
        return []
