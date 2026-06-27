import os
import unittest
from fastapi.testclient import TestClient

# Set testing database
os.environ["DATABASE_URL"] = "sqlite:///./test_room_expenses.db"

from main import app, Base, engine

class TestRoomExpenses(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create fresh tables
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        cls.client = TestClient(app)

    def test_01_create_room(self):
        response = self.client.post("/api/rooms", json={
            "roomName": "Dream Room",
            "roomCode": "ROOM77",
            "upiId": "admin@iob",
            "adminName": "Chandu"
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("roomId", data)
        self.assertEqual(data["roomName"], "Dream Room")
        self.assertEqual(data["roomCode"], "ROOM77")
        self.assertEqual(data["upiId"], "admin@iob")
        self.assertEqual(data["adminName"], "Chandu")
        self.__class__.room_id = data["roomId"]

    def test_02_join_room(self):
        # Join room with a new member
        response = self.client.post("/api/rooms/join", json={
            "roomName": "Dream Room",
            "roomCode": "ROOM77",
            "memberName": "Gowtham"
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["roomId"], self.__class__.room_id)
        self.assertEqual(data["memberName"], "Gowtham")

        # Join room as admin (already member)
        response = self.client.post("/api/rooms/join", json={
            "roomName": "Dream Room",
            "roomCode": "ROOM77",
            "memberName": "Chandu"
        })
        self.assertEqual(response.status_code, 200)

    def test_03_notes_and_settings(self):
        # Update notes
        response = self.client.put(f"/api/rooms/{self.__class__.room_id}/notes", json={
            "notes": "WiFi password: room77password"
        })
        self.assertEqual(response.status_code, 200)

        # Get summary to check notes
        response = self.client.get(f"/api/rooms/{self.__class__.room_id}/summary")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["notes"], "WiFi password: room77password")

    def test_04_transactions_and_retention(self):
        # Add deposit in Month 1 (Jan 2026)
        response = self.client.post(f"/api/rooms/{self.__class__.room_id}/deposits", json={
            "amount": 2000.0,
            "depositedBy": "Chandu",
            "date": "2026-01-15"
        })
        self.assertEqual(response.status_code, 200)

        # Add deposit in Month 2 (Feb 2026)
        response = self.client.post(f"/api/rooms/{self.__class__.room_id}/deposits", json={
            "amount": 1500.0,
            "depositedBy": "Gowtham",
            "date": "2026-02-10"
        })
        self.assertEqual(response.status_code, 200)

        # Add expense in Month 3 (Mar 2026)
        response = self.client.post(f"/api/rooms/{self.__class__.room_id}/expenses", json={
            "amount": 900.0,
            "purpose": "Utilities",
            "paidBy": "Chandu",
            "date": "2026-03-05",
            "splitAmong": ["Chandu", "Gowtham"]
        })
        self.assertEqual(response.status_code, 200)

        # Retrieve summary. Stored months should be Jan, Feb, Mar (3 months)
        response = self.client.get(f"/api/rooms/{self.__class__.room_id}/summary")
        data = response.json()
        self.assertEqual(len(data["storedMonths"]), 3)
        self.assertIn("2026-01", data["storedMonths"])
        self.assertIn("2026-02", data["storedMonths"])
        self.assertIn("2026-03", data["storedMonths"])

        # Check total calculations
        # Total Pot = 2000 (Chandu) + 1500 (Gowtham) = 3500
        # Total Spent = 900 (Utilities, split among Chandu + Gowtham: 450 each)
        # Balance = 3500 - 900 = 2600
        self.assertEqual(data["totalPot"], 3500.0)
        self.assertEqual(data["totalSpent"], 900.0)
        self.assertEqual(data["balance"], 2600.0)

        # Check byPerson calculations
        # Chandu: Deposited 2000, Spent 450, Balance = 1550 (positive)
        self.assertEqual(data["byPerson"]["Chandu"]["deposited"], 2000.0)
        self.assertEqual(data["byPerson"]["Chandu"]["expenseShare"], 450.0)
        self.assertEqual(data["byPerson"]["Chandu"]["balance"], 1550.0)
        
        # Gowtham: Deposited 1500, Spent 450, Balance = 1050 (positive)
        self.assertEqual(data["byPerson"]["Gowtham"]["deposited"], 1500.0)
        self.assertEqual(data["byPerson"]["Gowtham"]["expenseShare"], 450.0)
        self.assertEqual(data["byPerson"]["Gowtham"]["balance"], 1050.0)

        # NOW ADD A TRANSACTION IN MONTH 4 (Apr 2026) -> Trigger Retention Check!
        # This should delete Month 1 (Jan 2026) data, keeping Feb, Mar, Apr.
        response = self.client.post(f"/api/rooms/{self.__class__.room_id}/expenses", json={
            "amount": 600.0,
            "purpose": "Internet",
            "paidBy": "Gowtham",
            "date": "2026-04-01",
            "splitAmong": ["Chandu", "Gowtham"]
        })
        self.assertEqual(response.status_code, 200)

        # Retrieve summary again. Stored months should be Feb, Mar, Apr (Jan is deleted).
        response = self.client.get(f"/api/rooms/{self.__class__.room_id}/summary")
        data = response.json()
        self.assertEqual(len(data["storedMonths"]), 3)
        self.assertNotIn("2026-01", data["storedMonths"])
        self.assertIn("2026-02", data["storedMonths"])
        self.assertIn("2026-03", data["storedMonths"])
        self.assertIn("2026-04", data["storedMonths"])

        # Check total calculations after pruning Jan data
        # Pot should now exclude Jan deposit (2000), making it 1500.
        # Spent is 900 (Mar) + 600 (Apr) = 1500.
        # Balance = 1500 - 1500 = 0.
        self.assertEqual(data["totalPot"], 1500.0)
        self.assertEqual(data["totalSpent"], 1500.0)
        self.assertEqual(data["balance"], 0.0)

    @classmethod
    def tearDownClass(cls):
        # Close connection pool
        engine.dispose()
        # Clean up database files
        if os.path.exists("./test_room_expenses.db"):
            try:
                os.remove("./test_room_expenses.db")
            except Exception:
                pass

if __name__ == "__main__":
    unittest.main()
