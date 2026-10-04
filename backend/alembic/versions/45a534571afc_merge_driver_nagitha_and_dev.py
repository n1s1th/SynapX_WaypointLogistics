"""merge_driver_nagitha_and_dev

Revision ID: 45a534571afc
Revises: 0014_delivery_stop_outlet_eta, 0016_sos_photo
Create Date: 2026-10-04 17:20:46.436787

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '45a534571afc'
down_revision: Union[str, Sequence[str], None] = ('0014_delivery_stop_outlet_eta', '0016_sos_photo')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
