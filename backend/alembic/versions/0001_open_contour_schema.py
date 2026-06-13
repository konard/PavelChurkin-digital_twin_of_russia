"""схема открытого контура

Revision ID: 0001_open_contour_schema
Revises:
Create Date: 2026-06-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_open_contour_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "datasets",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("domain", sa.String(length=80), nullable=False, index=True),
        sa.Column("region", sa.String(length=120), nullable=False, index=True),
        sa.Column("source", sa.String(length=240), nullable=False),
        sa.Column("source_version", sa.Date(), nullable=False),
        sa.Column("license", sa.String(length=240), nullable=False),
        sa.Column("quality_flag", sa.String(length=32), nullable=False),
        sa.Column("known_limitations", sa.JSON(), nullable=False),
        sa.Column("passport", sa.JSON(), nullable=False),
        sa.Column("contour", sa.String(length=32), nullable=False, server_default="open"),
    )
    op.create_table(
        "layers",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column(
            "dataset_id",
            sa.String(length=120),
            sa.ForeignKey("datasets.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=240), nullable=False),
        sa.Column("domain", sa.String(length=80), nullable=False, index=True),
        sa.Column("region", sa.String(length=120), nullable=False, index=True),
        sa.Column("geometry_type", sa.String(length=40), nullable=False),
        sa.Column("style", sa.JSON(), nullable=False),
    )
    op.create_table(
        "objects",
        sa.Column("id", sa.String(length=160), primary_key=True),
        sa.Column(
            "layer_id",
            sa.String(length=120),
            sa.ForeignKey("layers.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=240), nullable=False),
        sa.Column("object_type", sa.String(length=120), nullable=False),
        sa.Column("oktmo", sa.String(length=20), nullable=False, index=True),
        sa.Column("properties", sa.JSON(), nullable=False),
        sa.Column("geometry", sa.Text(), nullable=True),
        sa.Column("aggregation_level", sa.String(length=32), nullable=False),
        sa.Column("pii_status", sa.String(length=32), nullable=False),
        sa.Column("contour", sa.String(length=32), nullable=False, server_default="open"),
    )
    op.create_table(
        "scenarios",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("category", sa.String(length=8), nullable=False),
        sa.Column("scenario_version", sa.String(length=80), nullable=False),
        sa.Column("model_version", sa.String(length=80), nullable=False),
        sa.Column("parameters_schema", sa.JSON(), nullable=False),
        sa.Column("data_requirements", sa.JSON(), nullable=False),
        sa.Column("contour", sa.String(length=32), nullable=False, server_default="open"),
    )
    op.create_table(
        "scenario_runs",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column(
            "scenario_id",
            sa.String(length=120),
            sa.ForeignKey("scenarios.id"),
            nullable=False,
        ),
        sa.Column("requested_by", sa.String(length=160), nullable=False),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("dataset_version", sa.Text(), nullable=False),
        sa.Column("model_version", sa.String(length=80), nullable=False),
        sa.Column("scenario_version", sa.String(length=80), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column("email", sa.String(length=240), nullable=False, unique=True),
        sa.Column("role", sa.String(length=40), nullable=False),
    )
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column("name", sa.String(length=240), nullable=False),
    )
    op.create_table(
        "roles",
        sa.Column("id", sa.String(length=80), primary_key=True),
        sa.Column("permissions", sa.JSON(), nullable=False),
    )
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=120),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("hash", sa.String(length=128), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("actor", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("contour", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.String(length=160), nullable=False),
        sa.Column("data_versions", sa.JSON(), nullable=False),
        sa.Column("previous_hash", sa.String(length=64), nullable=False),
        sa.Column("hash", sa.String(length=64), nullable=False, unique=True),
    )


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("api_keys")
    op.drop_table("roles")
    op.drop_table("organizations")
    op.drop_table("users")
    op.drop_table("scenario_runs")
    op.drop_table("scenarios")
    op.drop_table("objects")
    op.drop_table("layers")
    op.drop_table("datasets")
