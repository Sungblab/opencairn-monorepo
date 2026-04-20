"""OpenCairn agent runtime — thin facade over LangGraph + langchain-core.

12 agents import only from this module. Direct imports of langgraph or
langchain_core from apps/worker/src/worker/agents/ are forbidden (see lint rule in Task 16).
"""
