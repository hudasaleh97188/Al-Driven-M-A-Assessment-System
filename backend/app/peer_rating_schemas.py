"""
peer_rating_schemas.py
----------------------
Gemini structured-output schema for LLM-based scoring of M&A criteria.

All financial values must be reported in USD millions.
"""

# ---------------------------------------------------------------------------
# Schema for ALL LLM criteria scoring (single call, multi-company, multi-criterion)
# ---------------------------------------------------------------------------

ALL_LLM_SCORING_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "company_scores": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "company_name": {"type": "STRING"},
                    "criteria": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "criterion": {
                                    "type": "STRING",
                                    "description": "Exact criterion name.",
                                },
                                "score": {
                                    "type": "INTEGER",
                                    "description": "Score from 1 to 5.",
                                },
                                "justification": {
                                    "type": "STRING",
                                    "description": "One-sentence justification.",
                                },
                            },
                            "required": ["criterion", "score", "justification"],
                        },
                    },
                },
                "required": ["company_name", "criteria"],
            },
        },
    },
    "required": ["company_scores"],
}
