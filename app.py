import os
import streamlit as st
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState
import pandas as pd
import time

# Databricks SDK picks up DATABRICKS_HOST, DATABRICKS_CLIENT_ID,
# DATABRICKS_CLIENT_SECRET automatically from env
w = WorkspaceClient()

CATALOG = "databricks_virtue_foundation_dataset_dais_2026"
SCHEMA = "virtue_foundation_dataset"
WAREHOUSE_ID = os.environ.get("DATABRICKS_WAREHOUSE_ID", "")


@st.cache_data(ttl=300)
def run_query(sql: str) -> pd.DataFrame:
    if not WAREHOUSE_ID:
        st.error(
            "DATABRICKS_WAREHOUSE_ID environment variable is not set. "
            "Add it in the Databricks App environment settings."
        )
        return pd.DataFrame()
    response = w.statement_execution.execute_statement(
        warehouse_id=WAREHOUSE_ID,
        statement=sql,
        wait_timeout="30s",
    )
    if response.status.state != StatementState.SUCCEEDED:
        raise RuntimeError(f"Query failed: {response.status.error}")
    cols = [c.name for c in response.manifest.schema.columns]
    rows = response.result.data_array or []
    return pd.DataFrame(rows, columns=cols)


def facilities_page():
    st.header("Healthcare Facilities")
    state_filter = st.text_input("Filter by state (leave blank for all)")
    limit = st.slider("Max rows", 50, 500, 100, step=50)
    where = f"WHERE state ILIKE '%{state_filter}%'" if state_filter else ""
    df = run_query(
        f"SELECT * FROM {CATALOG}.{SCHEMA}.facilities {where} LIMIT {limit}"
    )
    if not df.empty:
        st.metric("Facilities shown", len(df))
        st.dataframe(df, use_container_width=True)
        st.download_button("Download CSV", df.to_csv(index=False), "facilities.csv")


def health_indicators_page():
    st.header("NFHS-5 District Health Indicators")
    district_filter = st.text_input("Filter by district")
    limit = st.slider("Max rows", 50, 500, 100, step=50)
    where = f"WHERE district ILIKE '%{district_filter}%'" if district_filter else ""
    df = run_query(
        f"SELECT * FROM {CATALOG}.{SCHEMA}.nfhs_5_district_health_indicators {where} LIMIT {limit}"
    )
    if not df.empty:
        st.metric("Districts shown", len(df))
        st.dataframe(df, use_container_width=True)
        st.download_button("Download CSV", df.to_csv(index=False), "nfhs5.csv")


def pincode_page():
    st.header("PIN Code Directory")
    pincode = st.text_input("Enter PIN code or district name")
    if pincode:
        df = run_query(
            f"""SELECT * FROM {CATALOG}.{SCHEMA}.india_post_pincode_directory
                WHERE pincode = '{pincode}' OR district ILIKE '%{pincode}%'
                LIMIT 200"""
        )
        if not df.empty:
            st.metric("Results", len(df))
            st.dataframe(df, use_container_width=True)
        else:
            st.info("No results found.")
    else:
        st.info("Enter a PIN code or district name above to search.")


def main():
    st.set_page_config(
        page_title="CarePilot",
        page_icon="🏥",
        layout="wide",
    )
    st.title("🏥 CarePilot — Your Hospital Agent")
    st.caption(
        f"Connected to `{os.environ.get('DATABRICKS_HOST', 'Databricks')}` · "
        f"Workspace `{os.environ.get('DATABRICKS_WORKSPACE_ID', '')}`"
    )

    if not WAREHOUSE_ID:
        st.warning(
            "**Setup required:** Set the `DATABRICKS_WAREHOUSE_ID` environment variable "
            "in Databricks Apps → Environment with your SQL warehouse ID."
        )

    page = st.sidebar.radio(
        "Navigate",
        ["Facilities", "Health Indicators", "PIN Code Lookup"],
    )
    if page == "Facilities":
        facilities_page()
    elif page == "Health Indicators":
        health_indicators_page()
    else:
        pincode_page()


if __name__ == "__main__":
    main()
