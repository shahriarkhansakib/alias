"""add_facebook_publishing_fields_to_connected_accounts

Revision ID: 0005_facebook_publishing
Revises: 0004_publishing
Create Date: 2026-10-04 10:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0005_facebook_publishing'
down_revision: Union[str, Sequence[str], None] = '0004_publishing'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('connected_accounts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('encrypted_access_token', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('encrypted_refresh_token', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('token_type', sa.String(length=32), nullable=True))
        batch_op.add_column(
            sa.Column(
                'scopes',
                sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'),
                server_default='[]',
                nullable=False,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table('connected_accounts', schema=None) as batch_op:
        batch_op.drop_column('scopes')
        batch_op.drop_column('token_type')
        batch_op.drop_column('token_expires_at')
        batch_op.drop_column('encrypted_refresh_token')
        batch_op.drop_column('encrypted_access_token')
