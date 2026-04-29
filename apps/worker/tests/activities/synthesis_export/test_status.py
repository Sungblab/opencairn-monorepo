"""Drift canary: every status-flip site uses the shared helper."""
from worker.activities.synthesis_export._status import set_status
from worker.activities.synthesis_export import fetch, synthesize, compile as compile_module


def test_all_three_activities_import_the_same_set_status_symbol():
    # If a future PR re-introduces a local copy, the imported symbol in the
    # module's namespace will diverge from the shared one. This assertion
    # locks the contract.
    assert fetch.set_status is set_status
    assert synthesize.set_status is set_status
    assert compile_module.set_status is set_status
