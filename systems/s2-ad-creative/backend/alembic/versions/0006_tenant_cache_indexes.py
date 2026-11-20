"""add_tenant_cache_composite_indexes

Revision ID: 0006_tenant_cache_indexes
Revises: 0005_facebook_publishing
Create Date: 2026-11-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006_tenant_cache_indexes'
down_revision: Union[str, Sequence[str], None] = '0005_facebook_publishing'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('generated_backgrounds', schema=None) as batch_op:
        batch_op.create_index('ix_generated_backgrounds_tenant_cache', ['tenant_id', 'cache_key'], unique=False)

    with op.batch_alter_table('composited_creatives', schema=None) as batch_op:
        batch_op.create_index('ix_composited_creatives_tenant_cache', ['tenant_id', 'cache_key'], unique=False)

    with op.batch_alter_table('final_rendered_creatives', schema=None) as batch_op:
        batch_op.create_index('ix_final_rendered_creatives_tenant_cache', ['tenant_id', 'cache_key'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('final_rendered_creatives', schema=None) as batch_op:
        batch_op.drop_index('ix_final_rendered_creatives_tenant_cache')

    with op.batch_alter_table('composited_creatives', schema=None) as batch_op:
        batch_op.drop_index('ix_composited_creatives_tenant_cache')

    with op.batch_alter_table('generated_backgrounds', schema=None) as batch_op:
        batch_op.drop_index('ix_generated_backgrounds_tenant_cache')

