"""Merge the store-manager and dispatcher migration branches.

Revision ID: 0007_merge_heads
Revises: 0006_delivery_issues, c82d14e09f6a
"""

from typing import Sequence, Union


revision: str = "0007_merge_heads"
down_revision: Union[str, Sequence[str], None] = ("0006_delivery_issues", "c82d14e09f6a")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
