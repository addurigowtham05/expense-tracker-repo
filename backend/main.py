import os
import uuid
import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import (
    create_engine, Column, String, Numeric, Date, DateTime, JSON, ForeignKey, UniqueConstraint, func, and_
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database setup
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Use local sqlite database as fallback
    DATABASE_URL = "sqlite:///./room_expenses.db"

# SQL Alchemy configurations
# If using SQLite, we need to allow multithread access
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# SQLAlchemy Models
class Room(Base):
    __tablename__ = "rooms"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    code = Column(String(50), nullable=False, unique=True)
    upi_id = Column(String(100), nullable=False)
    admin_name = Column(String(100), nullable=False)
    notes = Column(String(5000), default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Member(Base):
    __tablename__ = "members"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    __table_args__ = (UniqueConstraint("room_id", "name", name="uq_room_member"),)

class Expense(Base):
    __tablename__ = "expenses"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    purpose = Column(String(200), nullable=False)
    paid_by = Column(String(100), nullable=False)
    date = Column(Date, nullable=False)
    split_among = Column(JSON, nullable=False)  # List of member names
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Deposit(Base):
    __tablename__ = "deposits"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String(36), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    deposited_by = Column(String(100), nullable=False)
    date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

# Create tables
Base.metadata.create_all(bind=engine)

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# FastAPI Initialization
app = FastAPI(title="Room Expense Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas
class RoomCreate(BaseModel):
    room_name: str = Field(..., alias="roomName")
    room_code: str = Field(..., alias="roomCode")
    upi_id: str = Field(..., alias="upiId")
    admin_name: str = Field(..., alias="adminName")

    class Config:
        populate_by_name = True

class RoomJoin(BaseModel):
    room_name: str = Field(..., alias="roomName")
    room_code: str = Field(..., alias="roomCode")
    member_name: str = Field(..., alias="memberName")

    class Config:
        populate_by_name = True

class ExpenseCreate(BaseModel):
    amount: float
    purpose: str
    paid_by: str = Field(..., alias="paidBy")
    date: str  # YYYY-MM-DD
    split_among: List[str] = Field(..., alias="splitAmong")

    class Config:
        populate_by_name = True

class DepositCreate(BaseModel):
    amount: float
    deposited_by: str = Field(..., alias="depositedBy")
    date: str  # YYYY-MM-DD

    class Config:
        populate_by_name = True

class NotesUpdate(BaseModel):
    notes: str

class RoomSettingsUpdate(BaseModel):
    room_name: str = Field(..., alias="roomName")
    room_code: str = Field(..., alias="roomCode")
    upi_id: str = Field(..., alias="upiId")

    class Config:
        populate_by_name = True

# Helper: Get distinct calendar months from expenses and deposits dialect-safely
def get_distinct_months(db: Session, room_id: str) -> List[str]:
    dialect = db.bind.dialect.name
    if dialect == "sqlite":
        expense_months = db.query(func.strftime("%Y-%m", Expense.date)).filter(Expense.room_id == room_id).distinct().all()
        deposit_months = db.query(func.strftime("%Y-%m", Deposit.date)).filter(Deposit.room_id == room_id).distinct().all()
    else:
        # PostgreSQL / Supabase
        expense_months = db.query(func.to_char(Expense.date, "YYYY-MM")).filter(Expense.room_id == room_id).distinct().all()
        deposit_months = db.query(func.to_char(Deposit.date, "YYYY-MM")).filter(Deposit.room_id == room_id).distinct().all()
    
    months = set()
    for m in expense_months:
        if m[0]:
            months.add(m[0])
    for m in deposit_months:
        if m[0]:
            months.add(m[0])
    return sorted(list(months))

# Helper: Retention policy logic (Max 3 calendar months of data)
def apply_retention_policy(db: Session, room_id: str):
    all_months = get_distinct_months(db, room_id)

    # If we have more than 3 months, delete the oldest
    while len(all_months) > 3:
        oldest_month = all_months.pop(0)  # Remove and return oldest month YYYY-MM
        
        # Parse start and end of that month
        year, month = map(int, oldest_month.split("-"))
        start_date = datetime.date(year, month, 1)
        if month == 12:
            end_date = datetime.date(year + 1, 1, 1) - datetime.timedelta(days=1)
        else:
            end_date = datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)

        # Delete expenses in that month
        db.query(Expense).filter(
            and_(Expense.room_id == room_id, Expense.date >= start_date, Expense.date <= end_date)
        ).delete(synchronize_session=False)

        # Delete deposits in that month
        db.query(Deposit).filter(
            and_(Deposit.room_id == room_id, Deposit.date >= start_date, Deposit.date <= end_date)
        ).delete(synchronize_session=False)
        
        db.commit()

# API Endpoints
@app.post("/api/rooms")
def create_room(room_data: RoomCreate, db: Session = Depends(get_db)):
    # Check if code already exists
    existing = db.query(Room).filter(Room.code == room_data.room_code.upper()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Room code already exists. Please choose a different one.")
    
    room = Room(
        name=room_data.room_name,
        code=room_data.room_code.upper(),
        upi_id=room_data.upi_id,
        admin_name=room_data.admin_name
    )
    db.add(room)
    db.commit()
    db.refresh(room)

    # Add admin as first member
    admin_member = Member(room_id=room.id, name=room_data.admin_name)
    db.add(admin_member)
    db.commit()

    return {
        "roomId": room.id,
        "roomName": room.name,
        "roomCode": room.code,
        "upiId": room.upi_id,
        "adminName": room.admin_name
    }

@app.post("/api/rooms/join")
def join_room(join_data: RoomJoin, db: Session = Depends(get_db)):
    room = db.query(Room).filter(
        and_(func.lower(Room.name) == func.lower(join_data.room_name), 
             Room.code == join_data.room_code.upper())
    ).first()
    
    if not room:
        raise HTTPException(status_code=404, detail="Room name or room code is incorrect.")
    
    # Check if member already exists in that room
    member = db.query(Member).filter(
        and_(Member.room_id == room.id, func.lower(Member.name) == func.lower(join_data.member_name))
    ).first()
    
    if not member:
        # Create new member
        member = Member(room_id=room.id, name=join_data.member_name)
        db.add(member)
        db.commit()
        db.refresh(member)
    
    return {
        "roomId": room.id,
        "roomName": room.name,
        "roomCode": room.code,
        "upiId": room.upi_id,
        "adminName": room.admin_name,
        "memberName": member.name
    }

@app.get("/api/rooms/{room_id}/summary")
def get_room_summary(room_id: str, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    members = db.query(Member).filter(Member.room_id == room_id).all()
    member_names = [m.name for m in members]

    expenses = db.query(Expense).filter(Expense.room_id == room_id).all()
    deposits = db.query(Deposit).filter(Deposit.room_id == room_id).all()

    total_pot = float(sum(d.amount for d in deposits))
    total_spent = float(sum(e.amount for e in expenses))
    balance = total_pot - total_spent

    # Calculate by-person totals
    by_person = {name: {"deposited": 0.0, "expenseShare": 0.0, "balance": 0.0} for name in member_names}

    # Sum deposits
    for d in deposits:
        if d.deposited_by in by_person:
            by_person[d.deposited_by]["deposited"] += float(d.amount)
        else:
            # Fallback for deleted roommates or general
            by_person[d.deposited_by] = {"deposited": float(d.amount), "expenseShare": 0.0, "balance": 0.0}

    # Sum expenses split shares
    for e in expenses:
        split_list = e.split_among or []
        if not split_list:
            continue
        share = float(e.amount) / len(split_list)
        for name in split_list:
            if name in by_person:
                by_person[name]["expenseShare"] += share
            else:
                by_person[name] = {"deposited": 0.0, "expenseShare": share, "balance": 0.0}

    # Calculate net balance for each person
    for name, data in by_person.items():
        data["balance"] = data["deposited"] - data["expenseShare"]

    # Gather months of stored data dialect-safely
    all_months = get_distinct_months(db, room_id)

    return {
        "roomName": room.name,
        "roomCode": room.code,
        "upiId": room.upi_id,
        "adminName": room.admin_name,
        "notes": room.notes,
        "totalPot": total_pot,
        "totalSpent": total_spent,
        "balance": balance,
        "roommates": member_names,
        "byPerson": by_person,
        "storedMonths": all_months
    }

@app.get("/api/rooms/{room_id}/expenses")
def get_expenses(room_id: str, person: Optional[str] = "all", db: Session = Depends(get_db)):
    query = db.query(Expense).filter(Expense.room_id == room_id)
    expenses = query.all()
    
    # Filter in Python to handle JSON split_among search easily across databases
    if person and person != "all":
        expenses = [
            e for e in expenses 
            if e.paid_by == person or (e.split_among and person in e.split_among)
        ]
        
    # Sort descending by date
    expenses.sort(key=lambda x: x.date, reverse=True)
    
    return [
        {
            "id": e.id,
            "amount": float(e.amount),
            "purpose": e.purpose,
            "paidBy": e.paid_by,
            "date": e.date.isoformat(),
            "splitAmong": e.split_among
        }
        for e in expenses
    ]

@app.post("/api/rooms/{room_id}/expenses")
def add_expense(room_id: str, expense_data: ExpenseCreate, db: Session = Depends(get_db)):
    try:
        parsed_date = datetime.datetime.strptime(expense_data.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    expense = Expense(
        room_id=room_id,
        amount=expense_data.amount,
        purpose=expense_data.purpose,
        paid_by=expense_data.paid_by,
        date=parsed_date,
        split_among=expense_data.split_among
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)

    # Check and enforce 3-month retention
    apply_retention_policy(db, room_id)

    return {"message": "Expense added successfully", "expenseId": expense.id}

@app.put("/api/rooms/{room_id}/expenses/{expense_id}")
def update_expense(room_id: str, expense_id: str, expense_data: ExpenseCreate, db: Session = Depends(get_db)):
    expense = db.query(Expense).filter(and_(Expense.id == expense_id, Expense.room_id == room_id)).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    try:
        parsed_date = datetime.datetime.strptime(expense_data.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    expense.amount = expense_data.amount
    expense.purpose = expense_data.purpose
    expense.paid_by = expense_data.paid_by
    expense.date = parsed_date
    expense.split_among = expense_data.split_among
    
    db.commit()

    # Check and enforce 3-month retention
    apply_retention_policy(db, room_id)

    return {"message": "Expense updated successfully"}

@app.delete("/api/rooms/{room_id}/expenses/{expense_id}")
def delete_expense(room_id: str, expense_id: str, db: Session = Depends(get_db)):
    expense = db.query(Expense).filter(and_(Expense.id == expense_id, Expense.room_id == room_id)).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    db.delete(expense)
    db.commit()
    return {"message": "Expense deleted successfully"}

@app.get("/api/rooms/{room_id}/deposits")
def get_deposits(room_id: str, person: Optional[str] = "all", db: Session = Depends(get_db)):
    query = db.query(Deposit).filter(Deposit.room_id == room_id)
    deposits = query.all()

    if person and person != "all":
        deposits = [d for d in deposits if d.deposited_by == person]

    # Sort descending by date
    deposits.sort(key=lambda x: x.date, reverse=True)

    return [
        {
            "id": d.id,
            "amount": float(d.amount),
            "depositedBy": d.deposited_by,
            "date": d.date.isoformat()
        }
        for d in deposits
    ]

@app.post("/api/rooms/{room_id}/deposits")
def add_deposit(room_id: str, deposit_data: DepositCreate, db: Session = Depends(get_db)):
    try:
        parsed_date = datetime.datetime.strptime(deposit_data.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    deposit = Deposit(
        room_id=room_id,
        amount=deposit_data.amount,
        deposited_by=deposit_data.deposited_by,
        date=parsed_date
    )
    db.add(deposit)
    db.commit()
    db.refresh(deposit)

    # Check and enforce 3-month retention
    apply_retention_policy(db, room_id)

    return {"message": "Deposit added successfully", "depositId": deposit.id}

@app.put("/api/rooms/{room_id}/deposits/{deposit_id}")
def update_deposit(room_id: str, deposit_id: str, deposit_data: DepositCreate, db: Session = Depends(get_db)):
    deposit = db.query(Deposit).filter(and_(Deposit.id == deposit_id, Deposit.room_id == room_id)).first()
    if not deposit:
        raise HTTPException(status_code=404, detail="Deposit not found")

    try:
        parsed_date = datetime.datetime.strptime(deposit_data.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    deposit.amount = deposit_data.amount
    deposit.deposited_by = deposit_data.deposited_by
    deposit.date = parsed_date
    
    db.commit()

    # Check and enforce 3-month retention
    apply_retention_policy(db, room_id)

    return {"message": "Deposit updated successfully"}

@app.delete("/api/rooms/{room_id}/deposits/{deposit_id}")
def delete_deposit(room_id: str, deposit_id: str, db: Session = Depends(get_db)):
    deposit = db.query(Deposit).filter(and_(Deposit.id == deposit_id, Deposit.room_id == room_id)).first()
    if not deposit:
        raise HTTPException(status_code=404, detail="Deposit not found")
    
    db.delete(deposit)
    db.commit()
    return {"message": "Deposit deleted successfully"}

@app.put("/api/rooms/{room_id}/notes")
def update_notes(room_id: str, notes_data: NotesUpdate, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room.notes = notes_data.notes
    db.commit()
    return {"message": "Notes updated successfully"}

@app.put("/api/rooms/{room_id}/settings")
def update_settings(room_id: str, settings_data: RoomSettingsUpdate, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Check if code is already used by another room
    existing = db.query(Room).filter(
        and_(Room.code == settings_data.room_code.upper(), Room.id != room_id)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Room code already exists in another room.")
    
    room.name = settings_data.room_name
    room.code = settings_data.room_code.upper()
    room.upi_id = settings_data.upi_id
    db.commit()
    
    return {"message": "Room settings updated successfully"}

@app.delete("/api/rooms/{room_id}/members/{name}")
def delete_member(room_id: str, name: str, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
        
    if room.admin_name == name:
        raise HTTPException(status_code=400, detail="Cannot delete the admin of the room.")

    member = db.query(Member).filter(and_(Member.room_id == room_id, Member.name == name)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    db.delete(member)
    db.commit()
    return {"message": f"Member {name} deleted successfully"}
