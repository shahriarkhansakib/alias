"""multi_tenant_schema

Revision ID: 0002_multi_tenant
Revises: de560c1775e1
Create Date: 2026-09-28 09:10:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0002_multi_tenant'
down_revision: Union[str, Sequence[str], None] = 'de560c1775e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)
        batch_op.create_index(batch_op.f('ix_users_id'), ['id'], unique=False)

    # 2. Create tenants table
    op.create_table(
        'tenants',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('slug', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('tenants', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tenants_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_tenants_slug'), ['slug'], unique=True)

    # 3. Create memberships table
    op.create_table(
        'memberships',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('tenant_id', sa.String(length=36), nullable=False),
        sa.Column('role', sa.String(length=32), nullable=False, server_default='MEMBER'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'tenant_id', name='uq_user_tenant'),
    )
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_memberships_id'), ['id'], unique=False)
        batch_op.create_index(batch_op.f('ix_memberships_role'), ['role'], unique=False)
        batch_op.create_index(batch_op.f('ix_memberships_tenant_id'), ['tenant_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_memberships_user_id'), ['user_id'], unique=False)

    # 4. Add tenant_id to customer-owned tables
    tables = [
        ('ad_briefs', False),
        ('asset_validation_records', True),
        ('creative_strategies', False),
        ('creative_jobs', False),
        ('generated_backgrounds', False),
        ('composited_creatives', False),
        ('final_rendered_creatives', False),
    ]

    for table_name, is_nullable in tables:
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    'tenant_id',
                    sa.String(length=36),
                    nullable=is_nullable,
                    server_default='default-tenant-0000',
                )
            )
            batch_op.create_foreign_key(
                f'fk_{table_name}_tenant_id',
                'tenants',
                ['tenant_id'],
                ['id'],
                ondelete='CASCADE',
            )
            batch_op.create_index(
                f'ix_{table_name}_tenant_id',
                ['tenant_id'],
                unique=False,
            )


def downgrade() -> None:
    tables = [
        'final_rendered_creatives',
        'composited_creatives',
        'generated_backgrounds',
        'creative_jobs',
        'creative_strategies',
        'asset_validation_records',
        'ad_briefs',
    ]

    for table_name in tables:
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.drop_index(f'ix_{table_name}_tenant_id')
            batch_op.drop_constraint(f'fk_{table_name}_tenant_id', type_='foreignkey')
            batch_op.drop_column('tenant_id')

    op.drop_table('memberships')
    op.drop_table('tenants')
    op.drop_table('users')
