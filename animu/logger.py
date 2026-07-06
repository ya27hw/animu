import sys
import os
import logging
from logging.handlers import RotatingFileHandler

class LoggerWriter:
    def __init__(self, logger, level):
        self.logger = logger
        self.level = level

    def write(self, message):
        if message.strip():
            self.logger.log(self.level, message.rstrip())

    def flush(self):
        pass

def setup_logging():
    """Sets up Python RotatingFileHandlers and redirects stdout/stderr to them."""
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    log_dir = os.path.join(root_dir, 'logs')
    os.makedirs(log_dir, exist_ok=True)

    # 1. Combined logger
    combined_logger = logging.getLogger("combined")
    combined_logger.setLevel(logging.INFO)
    combined_handler = RotatingFileHandler(
        os.path.join(log_dir, "animu.log"),
        maxBytes=5 * 1024 * 1024,  # 5MB
        backupCount=3,
        encoding="utf-8"
    )
    combined_handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s'))
    combined_logger.addHandler(combined_handler)

    # 2. Out logger (Stdout)
    out_logger = logging.getLogger("stdout")
    out_logger.setLevel(logging.INFO)
    out_handler = RotatingFileHandler(
        os.path.join(log_dir, "animu-out.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8"
    )
    out_handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s'))
    out_logger.addHandler(out_handler)

    # 3. Error logger (Stderr)
    err_logger = logging.getLogger("stderr")
    err_logger.setLevel(logging.ERROR)
    err_handler = RotatingFileHandler(
        os.path.join(log_dir, "animu-error.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8"
    )
    err_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
    err_logger.addHandler(err_handler)

    # Also log stdout to the combined logger
    class DualLoggerWriter:
        def __init__(self, logger1, logger2, level):
            self.logger1 = logger1
            self.logger2 = logger2
            self.level = level

        def write(self, message):
            msg = message.rstrip()
            if msg:
                # Print to real terminal if run interactively
                sys.__stdout__.write(message)
                self.logger1.log(self.level, msg)
                self.logger2.log(self.level, msg)

        def flush(self):
            sys.__stdout__.flush()

    class DualErrorLoggerWriter:
        def __init__(self, logger_err, logger_comb):
            self.logger_err = logger_err
            self.logger_comb = logger_comb

        def write(self, message):
            msg = message.rstrip()
            if msg:
                sys.__stderr__.write(message)
                self.logger_err.log(logging.ERROR, msg)
                self.logger_comb.log(logging.ERROR, msg)

        def flush(self):
            sys.__stderr__.flush()

    sys.stdout = DualLoggerWriter(out_logger, combined_logger, logging.INFO)
    sys.stderr = DualErrorLoggerWriter(err_logger, combined_logger)
