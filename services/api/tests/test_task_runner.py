import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scripts.task import run


@patch("scripts.task.subprocess.run")
def test_task_runner_propagates_command_failure_without_traceback(
    mock_run: Mock,
) -> None:
    mock_run.return_value.returncode = 17
    with pytest.raises(SystemExit) as error:
        run("failing-command")
    assert error.value.code == 17
    mock_run.assert_called_once()
