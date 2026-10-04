"""driver issue reports: more problem types, saved once

- issuetype gets OUTLET_CLOSED, ACCESS_DENIED and ORDER_MISMATCH, so dispatch
  can tell these apart (they were all sent as CUSTOMER_UNAVAILABLE / DAMAGED_GOODS).
- issue_reports.client_action_id: the phone's id for a report, unique, so a
  report the offline queue sends again is not saved twice.

Additive only.

Revision ID: 0007_driver_issue_reports
Revises: 0006_run_dispatch_trip_unique
Create Date: 2026-10-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007_driver_issue_reports'
down_revision: Union[str, Sequence[str], None] = '0006_run_dispatch_trip_unique'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TYPES = ("OUTLET_CLOSED", "ACCESS_DENIED", "ORDER_MISMATCH")
INDEX = "ix_issue_reports_client_action_id"


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        # ADD VALUE can't share a transaction with statements that use the value
        with op.get_context().autocommit_block():
            for value in NEW_TYPES:
                op.execute(f"ALTER TYPE issuetype ADD VALUE IF NOT EXISTS '{value}'")
    op.add_column('issue_reports', sa.Column('client_action_id', sa.String(length=64), nullable=True))
    op.create_index(INDEX, 'issue_reports', ['client_action_id'], unique=True)


def downgrade() -> None:
    op.drop_index(INDEX, table_name='issue_reports')
    op.drop_column('issue_reports', 'client_action_id')
    # Postgres can't drop enum values; the three extra issuetype values stay (unused).
