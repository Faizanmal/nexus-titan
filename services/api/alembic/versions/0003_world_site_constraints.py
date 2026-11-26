"""Bind tenant-scoped world documents to identity sites."""

from alembic import op

revision = "0003_world_sites"
down_revision = "0002_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_foreign_key(
        "fk_world_documents_tenant_site",
        "world_documents",
        "sites",
        ["tenant_id", "site_id"],
        ["organization_id", "id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    raise RuntimeError(
        "World-document site-scope rollback is forward-only; use a reviewed compensating migration."
    )
