def test_register_and_login(client):
    # 1. Register a new user
    register_payload = {
        "email": "dispatcher@waypoint.com",
        "full_name": "Dispatcher One",
        "password": "SecurePassword123!",
        "role": "DISPATCHER",
        "is_active": True,
    }
    response = client.post("/api/v1/auth/register", json=register_payload)
    assert response.status_code == 201, response.text
    user_data = response.json()
    assert user_data["email"] == "dispatcher@waypoint.com"
    assert user_data["full_name"] == "Dispatcher One"
    assert "id" in user_data

    # 2. Prevent duplicate registration
    dup_response = client.post("/api/v1/auth/register", json=register_payload)
    assert dup_response.status_code == 400

    # 3. Login to obtain access token
    login_data = {
        "username": "dispatcher@waypoint.com",
        "password": "SecurePassword123!",
    }
    login_response = client.post("/api/v1/auth/login", data=login_data)
    assert login_response.status_code == 200, login_response.text
    token_data = login_response.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"

    # 4. Access protected /me endpoint with token
    token = token_data["access_token"]
    me_response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "dispatcher@waypoint.com"
