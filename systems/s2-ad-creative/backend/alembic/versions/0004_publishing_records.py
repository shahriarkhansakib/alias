"""add_publishing_records_and_connected_accounts

Revision ID: 0004_publishing
Revises: d78664b04d05
Create Date: 2026-10-03 18:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0004_publishing'
down_revision: Union[str, Sequence[str], None] = 'd78664b04d05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. connected_accounts table
    op.create_table(
        'connected_accounts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tenant_id', sa.String(length=36), nullable=False),
        sa.Column('platform', sa.String(length=32), nullable=False),
        sa.Column('account_name', sa.String(length=128), nullable=False),
        sa.Column('external_user_id', sa.String(length=128), nullable=False),
        sa.Column('status', sa.String(length=32), server_default='NOT_CONFIGURED', nullable=False),
        sa.Column(
            'config_metadata',
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'),
            nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('connected_accounts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_connected_accounts_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_connected_accounts_tenant_id'), ['tenant_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_connected_accounts_platform'), ['platform'], unique=False)

    # 2. publishing_records table
    op.create_table(
        'publishing_records',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tenant_id', sa.String(length=36), nullable=False),
        sa.Column('final_ad_id', sa.String(length=36), nullable=False),
        sa.Column('platform', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=32), server_default='PUBLISH_QUEUED', nullable=False),
        sa.Column('provider', sa.String(length=32), server_default='mock', nullable=False),
        sa.Column('external_account_id', sa.String(length=128), nullable=True),
        sa.Column('external_post_id', sa.String(length=256), nullable=True),
        sa.Column('post_url', sa.String(length=500), nullable=True),
        sa.Column('caption', sa.Text(), nullable=True),
        sa.Column(
            'platform_metadata',
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'),
            nullable=False,
        ),
        sa.Column('idempotency_key', sa.String(length=128), nullable=False),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempt_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column(
            'provider_response',
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'),
            nullable=False,
        ),
        sa.Column('error_code', sa.String(length=64), nullable=True),
        sa.Column('error_message', sa.String(length=1000), nullable=True),
        sa.Column(
            'provenance_chain',
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'),
            nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['final_ad_id'], ['final_rendered_creatives.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'idempotency_key', name='uq_publishing_tenant_idempotency'),
    )
    with op.batch_alter_table('publishing_records', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_publishing_records_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_publishing_records_tenant_id'), ['tenant_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_publishing_records_final_ad_id'), ['final_ad_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_publishing_records_platform'), ['platform'], unique=False)
        batch_op.create_index(batch_op.f('ix_publishing_records_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_publishing_records_external_account_id'), ['external_account_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_publishing_records_external_post_id'), ['external_post_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_publishing_records_idempotency_key'), ['idempotency_key'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('publishing_records', schema=None) as batch_op:
        batch_op.drop_constraint('uq_publishing_tenant_idempotency', type_='unique')
        batch_op.drop_index(batch_op.f('ix_publishing_records_idempotency_key'))
        batch_op.drop_index(batch_op.f('ix_publishing_records_external_post_id'))
        batch_op.drop_index(batch_op.f('ix_publishing_records_external_account_id'))
        batch_op.drop_index(batch_op.f('ix_publishing_records_status'))
        batch_op.drop_index(batch_op.f('ix_publishing_records_platform'))
        batch_op.drop_index(batch_op.f('ix_publishing_records_final_ad_id'))
        batch_op.drop_index(batch_op.f('ix_publishing_records_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_publishing_records_id'))
    op.drop_table('publishing_records')

    with op.batch_alter_table('connected_accounts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_connected_accounts_platform'))
        batch_op.drop_index(batch_op.f('ix_connected_accounts_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_connected_accounts_id'))
    op.drop_table('connected_accounts')
