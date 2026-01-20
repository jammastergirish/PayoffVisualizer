from fastapi.testclient import TestClient
from backend.main import app
from unittest.mock import patch
import pytest

client = TestClient(app)

def test_health_check():
    # Mock broker connection status
    with patch('backend.config.config._broker') as mock_broker:
        mock_broker.is_connected.return_value = True
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["broker_connected"] is True

def test_get_portfolio_offline():
    # If not connected, should return error or empty
    with patch('backend.config.config._broker') as mock_broker:
        mock_broker.is_connected.return_value = False
        response = client.get("/api/portfolio")
        assert response.status_code == 200
        data = response.json()
        assert "error" in data
        assert "Not connected to" in data["error"]
        assert data["positions"] == []

def test_get_portfolio_connected():
    with patch('backend.config.config._broker') as mock_broker:
        mock_broker.is_connected.return_value = True
        mock_broker.get_positions.return_value = [{"ticker": "TEST", "qty": 10}]
        mock_broker.get_account_summary.return_value = {}

        response = client.get("/api/portfolio")
        assert response.status_code == 200
        data = response.json()
        assert data["positions"] == [{"ticker": "TEST", "qty": 10}]
        assert "summary" in data
