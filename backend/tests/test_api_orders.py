import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
from backend.main import app
from backend.common.models import Order

client = TestClient(app, raise_server_exceptions=False)

@pytest.fixture
def mock_get_orders():
    # Mock the broker instance on config
    mock_broker = MagicMock()
    mock_broker.is_connected.return_value = True
    
    with patch('backend.main.config._broker', mock_broker):
        yield mock_broker.get_orders

def test_api_get_orders_success(mock_get_orders):
    # Mock return data
    mock_orders = [
        Order(order_id="1", symbol="AAPL", action="BUY", quantity=10, status="Submitted", filled_quantity=0, average_fill_price=0, time_placed="2026-01-01T10:00:00Z", account="ACC1", order_type="LMT"),
        Order(order_id="2", symbol="TSLA", action="SELL", quantity=5, status="Filled", filled_quantity=5, average_fill_price=200, time_placed="2026-01-01T11:00:00Z", account="ACC1", order_type="MKT")
    ]
    mock_get_orders.return_value = mock_orders

    response = client.get("/api/orders")
    
    assert response.status_code == 200
    data = response.json()
    assert "orders" in data
    assert len(data["orders"]) == 2
    assert data["orders"][0]["symbol"] == "AAPL"
    assert data["orders"][0]["status"] == "Submitted"

def test_api_get_orders_empty(mock_get_orders):
    mock_get_orders.return_value = []
    
    response = client.get("/api/orders")
    
    assert response.status_code == 200
    data = response.json()
    assert data["orders"] == []

def test_api_get_orders_failure(mock_get_orders):
    mock_get_orders.side_effect = Exception("Broker error")
    
    response = client.get("/api/orders")
    
    # Depending on error handling, might be 500
    assert response.status_code == 500
    data = response.json()
    assert "detail" in data
