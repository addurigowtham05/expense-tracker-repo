import React, { useState, useEffect, useRef } from 'react';
import { 
  Home, Plus, History, Settings, Menu, Moon, Sun, Trash2, Edit3, 
  Save, X, ChevronRight, User, PlusCircle, CheckCircle, QrCode, 
  Wallet, LogOut, FileText, Calendar, Filter, Users, ArrowUpRight, ArrowDownLeft,
  Copy, Check, ExternalLink
} from 'lucide-react';

const API_BASE = "https://gowtham9010656-room-expense-backend.hf.space/api";

// Safe API response parser: prevents "Unexpected token 'Y', 'Your space' is not valid JSON" crashes when Hugging Face wakes up
const parseApiResponse = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes("Your space") || res.status === 503 || res.status === 502) {
      throw new Error("Server is waking up from sleep (takes ~15-20s). Please tap again in a moment.");
    }
    throw new Error(text || `Server error (${res.status})`);
  }
};

function App() {
  // Authentication & Room State
  const [joinedRooms, setJoinedRooms] = useState(() => {
    try {
      const saved = localStorage.getItem('room_tracker_joined_rooms');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [currentSession, setCurrentSession] = useState(() => {
    try {
      const saved = localStorage.getItem('room_tracker_current_session');
      return saved ? JSON.parse(saved) : null; // { roomId, roomName, roomCode, memberName, upiId, adminName }
    } catch {
      return null;
    }
  });

  // UI State
  const [activeTab, setActiveTab] = useState('home'); // home, add, history, settings
  const [activeAddSection, setActiveAddSection] = useState('expense'); // expense, deposit
  const [activeHistorySection, setActiveHistorySection] = useState('expense'); // expense, deposit
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('room_tracker_dark_mode') === 'true';
  });

  // Login Flow State
  const [loginMode, setLoginMode] = useState('enter'); // enter, create
  const [inputRoomName, setInputRoomName] = useState('');
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [inputMemberName, setInputMemberName] = useState('');
  const [inputUpiId, setInputUpiId] = useState('');
  const [inputAdminName, setInputAdminName] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Data State
  const [summary, setSummary] = useState({
    roomName: '', roomCode: '', upiId: '', adminName: '', notes: '',
    totalPot: 0, totalSpent: 0, balance: 0, roommates: [], byPerson: {}, storedMonths: []
  });
  const [expenses, setExpenses] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [expenseFilter, setExpenseFilter] = useState('mine');
  const [depositFilter, setDepositFilter] = useState('mine');
  const [dataLoading, setDataLoading] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  // Form inputs
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePurpose, setExpensePurpose] = useState('');
  const [expensePaidBy, setExpensePaidBy] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [expenseSplitAmong, setExpenseSplitAmong] = useState([]);

  const [depositAmount, setDepositAmount] = useState('');
  const [depositDate, setDepositDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Settings inputs
  const [sharedNotes, setSharedNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [roomSettingsName, setRoomSettingsName] = useState('');
  const [roomSettingsCode, setRoomSettingsCode] = useState('');
  const [roomSettingsUpi, setRoomSettingsUpi] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  // Editing state
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editExpenseAmount, setEditExpenseAmount] = useState('');
  const [editExpensePurpose, setEditExpensePurpose] = useState('');
  const [editExpensePaidBy, setEditExpensePaidBy] = useState('');
  const [editExpenseDate, setEditExpenseDate] = useState('');
  const [editExpenseSplit, setEditExpenseSplit] = useState([]);

  const [editingDepositId, setEditingDepositId] = useState(null);
  const [editDepositAmount, setEditDepositAmount] = useState('');
  const [editDepositBy, setEditDepositBy] = useState('');
  const [editDepositDate, setEditDepositDate] = useState('');

  // Dialog & Notification state
  const [popup, setPopup] = useState({ show: false, message: '' });
  const [upiPaymentModal, setUpiPaymentModal] = useState({ show: false, upiLink: '', amount: '' });
  const [showModalQr, setShowModalQr] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, type: '', id: '', name: '' });

  // Dark Mode effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('room_tracker_dark_mode', isDarkMode);
  }, [isDarkMode]);

  // Sync joined rooms and session to local storage
  useEffect(() => {
    localStorage.setItem('room_tracker_joined_rooms', JSON.stringify(joinedRooms));
  }, [joinedRooms]);

  useEffect(() => {
    if (currentSession) {
      localStorage.setItem('room_tracker_current_session', JSON.stringify(currentSession));
      loadRoomData(currentSession.roomId);
    } else {
      localStorage.removeItem('room_tracker_current_session');
    }
  }, [currentSession]);

  // Popup auto-hide
  useEffect(() => {
    if (popup.show) {
      const timer = setTimeout(() => {
        setPopup({ show: false, message: '' });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [popup.show]);

  // Load notes when summary notes change
  useEffect(() => {
    setSharedNotes(summary.notes || '');
    setRoomSettingsName(summary.roomName || '');
    setRoomSettingsCode(summary.roomCode || '');
    setRoomSettingsUpi(summary.upiId || '');
  }, [summary]);

  const showPopup = (msg) => {
    setPopup({ show: true, message: msg });
  };

  // API Call Helpers with Instant Local Cache & Parallel Fetching
  const loadRoomData = async (roomId, forceRefresh = false) => {
    if (!roomId) return;

    // 1. Instant Cache Load (Zero UI Lag)
    const cacheKey = `budget_room_cache_${roomId}`;
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.summary) setSummary(parsed.summary);
          if (parsed.expenses) setExpenses(parsed.expenses);
          if (parsed.deposits) setDeposits(parsed.deposits);
          if (parsed.summary?.roommates && expenseSplitAmong.length === 0) {
            setExpenseSplitAmong(parsed.summary.roommates);
          }
        }
      } catch (e) {
        // ignore cache read issues
      }
    }

    setDataLoading(true);
    try {
      // 2. High-speed single-flight request
      let fullLoaded = false;
      try {
        const fullRes = await fetch(`${API_BASE}/rooms/${roomId}/full_data`);
        if (fullRes.ok) {
          const fullData = await parseApiResponse(fullRes);
          if (fullData.summary) {
            setSummary(fullData.summary);
            if (fullData.summary.roommates && expenseSplitAmong.length === 0) {
              setExpenseSplitAmong(fullData.summary.roommates);
            }
          }
          if (fullData.expenses) setExpenses(fullData.expenses);
          if (fullData.deposits) setDeposits(fullData.deposits);

          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              summary: fullData.summary,
              expenses: fullData.expenses,
              deposits: fullData.deposits,
              timestamp: Date.now()
            }));
          } catch (e) {}
          fullLoaded = true;
        }
      } catch (e) {
        // Fallback to parallel requests
      }

      // 3. Parallel fallback if single-flight is unavailable
      if (!fullLoaded) {
        const [summaryRes, expensesRes, depositsRes] = await Promise.all([
          fetch(`${API_BASE}/rooms/${roomId}/summary`),
          fetch(`${API_BASE}/rooms/${roomId}/expenses`),
          fetch(`${API_BASE}/rooms/${roomId}/deposits`)
        ]);

        let newSummary = null, newExpenses = null, newDeposits = null;

        if (summaryRes.ok) {
          newSummary = await parseApiResponse(summaryRes);
          setSummary(newSummary);
          if (newSummary.roommates && expenseSplitAmong.length === 0) {
            setExpenseSplitAmong(newSummary.roommates);
          }
        }
        if (expensesRes.ok) {
          newExpenses = await parseApiResponse(expensesRes);
          setExpenses(newExpenses);
        }
        if (depositsRes.ok) {
          newDeposits = await parseApiResponse(depositsRes);
          setDeposits(newDeposits);
        }

        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            summary: newSummary || summary,
            expenses: newExpenses || expenses,
            deposits: newDeposits || deposits,
            timestamp: Date.now()
          }));
        } catch (e) {}
      }
    } catch (err) {
      console.error("Error loading room data: ", err);
    } finally {
      setDataLoading(false);
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!inputRoomName.trim() || !inputRoomCode.trim() || !inputUpiId.trim() || !inputAdminName.trim()) {
      setLoginError("Please fill in all fields.");
      return;
    }
    setLoginLoading(true);
    try {
      const response = await fetch(`${API_BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: inputRoomName.trim(),
          roomCode: inputRoomCode.trim().toUpperCase(),
          upiId: inputUpiId.trim(),
          adminName: inputAdminName.trim()
        })
      });

      const resData = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(resData?.detail || "Failed to create room.");
      }

      const room = resData;
      
      const newSession = {
        roomId: room.roomId,
        roomName: room.roomName,
        roomCode: room.roomCode,
        upiId: room.upiId,
        adminName: room.adminName,
        memberName: room.adminName // Creator is the first member
      };

      // Add to joined rooms
      setJoinedRooms(prev => {
        if (!prev.some(r => r.roomId === room.roomId)) {
          return [...prev, newSession];
        }
        return prev;
      });

      setCurrentSession(newSession);
      showPopup("Room created successfully!");
      resetLoginForm();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!inputRoomName.trim() || !inputRoomCode.trim() || !inputMemberName.trim()) {
      setLoginError("Please fill in all fields.");
      return;
    }
    setLoginLoading(true);
    try {
      const response = await fetch(`${API_BASE}/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: inputRoomName.trim(),
          roomCode: inputRoomCode.trim().toUpperCase(),
          memberName: inputMemberName.trim()
        })
      });

      const resData = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(resData?.detail || "Room name or code is incorrect.");
      }

      const room = resData;
      
      const newSession = {
        roomId: room.roomId,
        roomName: room.roomName,
        roomCode: room.roomCode,
        upiId: room.upiId,
        adminName: room.adminName,
        memberName: room.memberName
      };

      // Add to joined rooms list
      setJoinedRooms(prev => {
        const filtered = prev.filter(r => r.roomId !== room.roomId);
        return [...filtered, newSession];
      });

      setCurrentSession(newSession);
      showPopup("Joined room successfully!");
      resetLoginForm();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const resetLoginForm = () => {
    setInputRoomName('');
    setInputRoomCode('');
    setInputMemberName('');
    setInputUpiId('');
    setInputAdminName('');
    setLoginError('');
  };

  const handleSwitchRoom = (room) => {
    setCurrentSession(room);
    setShowSideMenu(false);
    setActiveTab('home');
  };

  const handleExitRoom = () => {
    if (!currentSession) return;
    const confirmExit = window.confirm("Are you sure you want to exit this room? You can re-enter with the name and code.");
    if (confirmExit) {
      const roomToRemove = currentSession.roomId;
      setJoinedRooms(prev => prev.filter(r => r.roomId !== roomToRemove));
      setCurrentSession(null);
      setShowSideMenu(false);
    }
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!expenseAmount || parseFloat(expenseAmount) <= 0 || !expensePurpose.trim() || !expensePaidBy) {
      alert("Please fill in valid expense details.");
      return;
    }
    if (expenseSplitAmong.length === 0) {
      alert("Please select at least one roommate to split among.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(expenseAmount),
          purpose: expensePurpose.trim(),
          paidBy: expensePaidBy,
          date: expenseDate,
          splitAmong: expenseSplitAmong
        })
      });

      if (!response.ok) throw new Error("Failed to add expense.");

      showPopup("Expense added");
      setExpenseAmount('');
      setExpensePurpose('');
      setExpenseDate(new Date().toISOString().split('T')[0]);
      // Reload
      loadRoomData(currentSession.roomId);
      // Switch to home
      setActiveTab('home');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCopyUpi = () => {
    if (summary.upiId) {
      navigator.clipboard.writeText(summary.upiId);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
    }
  };

  const openPaymentApp = (scheme) => {
    const amt = parseFloat(upiPaymentModal.amount || depositAmount || '0').toFixed(2);
    const pa = summary.upiId;
    const pn = encodeURIComponent(summary.roomName);
    const tn = encodeURIComponent(`RoomDeposit-${currentSession?.memberName || 'Member'}`);
    
    let url = '';
    if (scheme === 'gpay') {
      url = `gpay://upi/pay?pa=${pa}&pn=${pn}&am=${amt}&cu=INR&tn=${tn}`;
    } else if (scheme === 'phonepe') {
      url = `phonepe://pay?pa=${pa}&pn=${pn}&am=${amt}&cu=INR&tn=${tn}`;
    } else if (scheme === 'paytm') {
      url = `paytmmp://pay?pa=${pa}&pn=${pn}&am=${amt}&cu=INR&tn=${tn}`;
    } else {
      url = `upi://pay?pa=${pa}&pn=${pn}&am=${amt}&cu=INR&tn=${tn}`;
    }

    window.location.href = url;
  };

  const handleAddDeposit = (e) => {
    e.preventDefault();
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      alert("Please enter a valid deposit amount.");
      return;
    }

    const amt = parseFloat(depositAmount).toFixed(2);
    const pa = summary.upiId;
    const pn = encodeURIComponent(summary.roomName);
    const memName = encodeURIComponent(currentSession.memberName);
    const upiLink = `upi://pay?pa=${pa}&pn=${pn}&am=${amt}&cu=INR&tn=RoomDeposit-${memName}`;

    // Open Payment Choice dialog directly without blindly redirecting
    // (Prevents iPhone Safari from hijacking to WhatsApp Pay)
    setUpiPaymentModal({
      show: true,
      upiLink: upiLink,
      amount: amt
    });
  };

  const confirmUpiDepositAdded = async () => {
    try {
      const response = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(upiPaymentModal.amount),
          depositedBy: currentSession.memberName,
          date: depositDate
        })
      });

      if (!response.ok) throw new Error("Failed to record deposit.");

      setUpiPaymentModal({ show: false, upiLink: '', amount: '' });
      setDepositAmount('');
      setDepositDate(new Date().toISOString().split('T')[0]);
      showPopup("Deposit added successfully!");
      loadRoomData(currentSession.roomId, true);
      setActiveTab('home');
    } catch (err) {
      alert(err.message);
    }
  };

  // Editing Transactions
  const startEditExpense = (exp) => {
    setEditingExpenseId(exp.id);
    setEditExpenseAmount(exp.amount.toString());
    setEditExpensePurpose(exp.purpose);
    setEditExpensePaidBy(exp.paidBy);
    setEditExpenseDate(exp.date);
    setEditExpenseSplit(exp.splitAmong || []);
  };

  const saveEditExpense = async (id) => {
    if (!editExpenseAmount || parseFloat(editExpenseAmount) <= 0 || !editExpensePurpose.trim() || !editExpensePaidBy) {
      alert("Please fill in valid expense details.");
      return;
    }
    if (editExpenseSplit.length === 0) {
      alert("Please select at least one member to split among.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(editExpenseAmount),
          purpose: editExpensePurpose.trim(),
          paidBy: editExpensePaidBy,
          date: editExpenseDate,
          splitAmong: editExpenseSplit
        })
      });

      if (!response.ok) throw new Error("Failed to update expense.");

      setEditingExpenseId(null);
      showPopup("Expense updated");
      loadRoomData(currentSession.roomId);
    } catch (err) {
      alert(err.message);
    }
  };

  const startEditDeposit = (dep) => {
    setEditingDepositId(dep.id);
    setEditDepositAmount(dep.amount.toString());
    setEditDepositBy(dep.depositedBy);
    setEditDepositDate(dep.date);
  };

  const saveEditDeposit = async (id) => {
    if (!editDepositAmount || parseFloat(editDepositAmount) <= 0 || !editDepositBy) {
      alert("Please fill in valid deposit details.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/deposits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(editDepositAmount),
          depositedBy: editDepositBy,
          date: editDepositDate
        })
      });

      if (!response.ok) throw new Error("Failed to update deposit.");

      setEditingDepositId(null);
      showPopup("Deposit updated");
      loadRoomData(currentSession.roomId);
    } catch (err) {
      alert(err.message);
    }
  };

  // Delete flow
  const initiateDelete = (type, id, name) => {
    setDeleteConfirm({ show: true, type, id, name });
  };

  const confirmDelete = async () => {
    const { type, id, name } = deleteConfirm;
    try {
      if (type === 'expense') {
        const res = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/expenses/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Failed to delete expense");
        showPopup("Expense deleted");
      } else if (type === 'deposit') {
        const res = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/deposits/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Failed to delete deposit");
        showPopup("Deposit deleted");
      } else if (type === 'member') {
        const res = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/members/${name}`, { method: 'DELETE' });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || "Failed to delete member");
        }
        showPopup(`Member ${name} deleted`);
      }
      loadRoomData(currentSession.roomId);
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleteConfirm({ show: false, type: '', id: '', name: '' });
    }
  };

  // Shared Notes
  const handleSaveNotes = async () => {
    setNotesSaving(true);
    try {
      const response = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: sharedNotes })
      });
      if (!response.ok) throw new Error("Failed to save notes.");
      showPopup("Notes updated for all");
    } catch (err) {
      alert(err.message);
    } finally {
      setNotesSaving(false);
    }
  };

  // Settings Update
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSettingsError('');
    if (!roomSettingsName.trim() || !roomSettingsCode.trim() || !roomSettingsUpi.trim()) {
      setSettingsError("Fields cannot be empty.");
      return;
    }
    setSettingsSaving(true);
    try {
      const response = await fetch(`${API_BASE}/rooms/${currentSession.roomId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: roomSettingsName.trim(),
          roomCode: roomSettingsCode.trim().toUpperCase(),
          upiId: roomSettingsUpi.trim()
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Failed to update room settings.");
      }

      showPopup("Room settings updated!");
      // Update session locally too
      const updatedSession = {
        ...currentSession,
        roomName: roomSettingsName.trim(),
        roomCode: roomSettingsCode.trim().toUpperCase(),
        upiId: roomSettingsUpi.trim()
      };
      setCurrentSession(updatedSession);
      
      // Update in joined rooms list
      setJoinedRooms(prev => 
        prev.map(r => r.roomId === currentSession.roomId ? updatedSession : r)
      );

      loadRoomData(currentSession.roomId);
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSettingsSaving(false);
    }
  };

  // Form helpers
  const handleToggleSplit = (checked, person) => {
    if (checked) {
      setExpenseSplitAmong(prev => [...prev, person]);
    } else {
      setExpenseSplitAmong(prev => prev.filter(p => p !== person));
    }
  };

  const handleToggleEditSplit = (checked, person) => {
    if (checked) {
      setEditExpenseSplit(prev => [...prev, person]);
    } else {
      setEditExpenseSplit(prev => prev.filter(p => p !== person));
    }
  };

  // Display Format Helpers
  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(val || 0);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      // return dd/mm/yr (e.g. 25/06/26)
      return `${parts[2]}/${parts[1]}/${parts[0].substring(2)}`;
    }
    return dateStr;
  };

  const getMonthName = (yearMonth) => {
    if (!yearMonth) return '';
    const [year, month] = yearMonth.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleString('default', { month: 'short' });
  };

  // Filter lists with default 'mine' (User involved transactions)
  const myName = currentSession?.memberName;

  const filteredExpenses = expenses.filter(exp => {
    if (expenseFilter === 'all') return true;
    if (expenseFilter === 'mine') {
      if (!myName) return true;
      const isPaidByMe = exp.paidBy && exp.paidBy.toLowerCase() === myName.toLowerCase();
      const isInSplit = exp.splitAmong && exp.splitAmong.some(p => p.toLowerCase() === myName.toLowerCase());
      return isPaidByMe || isInSplit;
    }
    return exp.paidBy === expenseFilter || (exp.splitAmong && exp.splitAmong.includes(expenseFilter));
  });

  const filteredDeposits = deposits.filter(dep => {
    if (depositFilter === 'all') return true;
    if (depositFilter === 'mine') {
      if (!myName) return true;
      return dep.depositedBy && dep.depositedBy.toLowerCase() === myName.toLowerCase();
    }
    return dep.depositedBy === depositFilter;
  });

  // Group by date
  const groupExpensesByDate = () => {
    const groups = {};
    filteredExpenses.forEach(exp => {
      if (!groups[exp.date]) {
        groups[exp.date] = [];
      }
      groups[exp.date].push(exp);
    });
    return Object.entries(groups).sort((a, b) => new Date(b[0]) - new Date(a[0]));
  };

  const groupDepositsByDate = () => {
    const groups = {};
    filteredDeposits.forEach(dep => {
      if (!groups[dep.date]) {
        groups[dep.date] = [];
      }
      groups[dep.date].push(dep);
    });
    return Object.entries(groups).sort((a, b) => new Date(b[0]) - new Date(a[0]));
  };

  // Initializing paidBy defaults
  useEffect(() => {
    if (currentSession && summary.roommates.length > 0) {
      if (!expensePaidBy) {
        setExpensePaidBy(currentSession.memberName);
      }
    }
  }, [summary, currentSession]);

  // Is Admin Check
  const isAdmin = currentSession && summary.adminName === currentSession.memberName;

  // Render Login Page
  if (!currentSession) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        {/* App Frame Overlay for styling */}
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-800 p-6 sm:p-8 flex flex-col">
          
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-500 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">
              Budget
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">
              Settle transactions seamlessly with Supabase & UPI
            </p>
          </div>

          <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl mb-6">
            <button 
              onClick={() => { setLoginMode('enter'); setLoginError(''); }}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${loginMode === 'enter' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
            >
              Enter a Room
            </button>
            <button 
              onClick={() => { setLoginMode('create'); setLoginError(''); }}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${loginMode === 'create' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
            >
              Create a Room
            </button>
          </div>

          {loginError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-semibold mb-4 text-center">
              {loginError}
            </div>
          )}

          {loginMode === 'enter' ? (
            <form onSubmit={handleJoinRoom} className="space-y-4 flex-1">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Room Name</label>
                <input 
                  type="text" 
                  value={inputRoomName}
                  onChange={(e) => setInputRoomName(e.target.value)}
                  placeholder="Enter Room Name"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-sm transition-all"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Room Code</label>
                <input 
                  type="text" 
                  value={inputRoomCode}
                  onChange={(e) => setInputRoomCode(e.target.value)}
                  placeholder="Enter Room Code"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-widest uppercase text-sm text-center transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Your Name</label>
                <input 
                  type="text" 
                  value={inputMemberName}
                  onChange={(e) => setInputMemberName(e.target.value)}
                  placeholder="Your Name (e.g. Chandu)"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-sm transition-all"
                  required
                />
              </div>

              <button 
                type="submit"
                disabled={loginLoading}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-3.5 px-4 rounded-xl font-bold text-sm shadow-md hover:from-indigo-700 hover:to-violet-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-all flex items-center justify-center space-x-2 mt-6 active:scale-[0.98]"
              >
                {loginLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span>Enter Room</span>
                    <ChevronRight size={16} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCreateRoom} className="space-y-4 flex-1">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Room Name</label>
                <input 
                  type="text" 
                  value={inputRoomName}
                  onChange={(e) => setInputRoomName(e.target.value)}
                  placeholder="e.g. Dream Room"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-sm transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Room Code</label>
                <input 
                  type="text" 
                  value={inputRoomCode}
                  onChange={(e) => setInputRoomCode(e.target.value)}
                  placeholder="e.g. ROOM77"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-widest uppercase text-sm text-center transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Admin Name</label>
                <input 
                  type="text" 
                  value={inputAdminName}
                  onChange={(e) => setInputAdminName(e.target.value)}
                  placeholder="Your Name (You will be Admin)"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-sm transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">UPI ID for Deposits (IOB)</label>
                <input 
                  type="text" 
                  value={inputUpiId}
                  onChange={(e) => setInputUpiId(e.target.value)}
                  placeholder="e.g. admin@iob"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm transition-all"
                  required
                />
              </div>

              <button 
                type="submit"
                disabled={loginLoading}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-3.5 px-4 rounded-xl font-bold text-sm shadow-md hover:from-indigo-700 hover:to-violet-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-all flex items-center justify-center space-x-2 mt-6 active:scale-[0.98]"
              >
                {loginLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span>Create Room & Register</span>
                    <PlusCircle size={16} />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Quick Switch for Dev if rooms are cached */}
          {joinedRooms.length > 0 && (
            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Re-enter Saved Rooms</p>
              <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hide">
                {joinedRooms.map((room) => (
                  <button
                    key={room.roomId}
                    onClick={() => handleSwitchRoom(room)}
                    className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-all text-left text-xs font-semibold text-slate-700 dark:text-slate-350"
                  >
                    <div>
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold">{room.roomName}</span>
                      <span className="mx-1 border-r border-slate-300 dark:border-slate-600 h-3 inline-block"></span>
                      <span className="font-mono">{room.roomCode}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      As {room.memberName}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main UI Screen
  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex justify-center items-start sm:py-6">
      
      {/* Mobile App Container Frame */}
      <div className="w-full sm:max-w-md h-[100dvh] sm:h-[844px] bg-slate-50 dark:bg-slate-900 sm:rounded-[36px] sm:shadow-2xl overflow-hidden border border-transparent sm:border-slate-200 dark:sm:border-slate-800 flex flex-col relative">
        
        {/* APP HEADER */}
        <header className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 shrink-0 z-30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setShowSideMenu(true)}
              className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-all"
              aria-label="Open side menu"
            >
              <Menu size={22} />
            </button>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white leading-5">{summary.roomName || currentSession.roomName}</h2>
              <p className="text-[10px] font-mono font-semibold tracking-wider text-indigo-500">{summary.roomCode || currentSession.roomCode}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            {dataLoading && (
              <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mr-1"></div>
            )}
            <div className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {currentSession.memberName}
            </div>
          </div>
        </header>

        {/* POPUP NOTIFICATION */}
        {popup.show && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-indigo-600 text-white px-5 py-2.5 rounded-full text-xs font-bold shadow-lg flex items-center space-x-2 animate-bounce">
            <CheckCircle size={14} />
            <span>{popup.message}</span>
          </div>
        )}

        {/* MAIN BODY SCROLL */}
        <main className="flex-1 overflow-y-auto p-4 pb-28 scrollbar-hide">
          {dataLoading && !summary.roomName ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-semibold text-slate-400">Loading data from Supabase...</span>
            </div>
          ) : (
            <>
              {/* TAB 1: HOME */}
              {activeTab === 'home' && (
                <div className="space-y-5">
                  {/* Summary Pot Card */}
                  <div className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-3xl p-5 shadow-lg relative overflow-hidden">
                    {/* Background visual graphics */}
                    <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 w-32 h-32 bg-white/5 rounded-full blur-xl pointer-events-none"></div>
                    <div className="absolute left-1/4 top-0 -translate-y-8 w-24 h-24 bg-white/5 rounded-full blur-lg pointer-events-none"></div>
                    
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <p className="text-[10px] uppercase font-bold tracking-widest text-indigo-200">Total Pot (IOB)</p>
                        <p className="text-lg font-bold mt-1">{formatCurrency(summary.totalPot)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase font-bold tracking-widest text-indigo-200">Total Spent</p>
                        <p className="text-lg font-bold mt-1">{formatCurrency(summary.totalSpent)}</p>
                      </div>
                    </div>

                    <div className="text-center pt-2 border-t border-white/10">
                      <p className="text-[10px] uppercase font-bold tracking-widest text-indigo-200 mb-1">Available balance</p>
                      <h3 className="text-3xl font-extrabold tracking-tight">
                        {formatCurrency(summary.balance)}
                      </h3>
                    </div>
                  </div>

                  {/* Active Month pills */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Stored Months</h4>
                    <div className="flex items-center space-x-2 overflow-x-auto scrollbar-hide py-1">
                      {summary.storedMonths && summary.storedMonths.length > 0 ? (
                        summary.storedMonths.map((m) => (
                          <div 
                            key={m}
                            className="bg-white dark:bg-slate-800 px-4 py-2 rounded-xl text-xs font-bold shadow-sm border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-350 flex items-center space-x-1.5"
                          >
                            <Calendar size={12} className="text-indigo-500" />
                            <span>{getMonthName(m)}</span>
                            <span className="text-[9px] text-slate-400 font-mono">({m})</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">No months stored</span>
                      )}
                    </div>
                  </div>

                  {/* Member balances list */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">Roommate Balances</h4>
                    <div className="space-y-3">
                      {summary.roommates && summary.roommates.map((name) => {
                        const personData = summary.byPerson[name] || { deposited: 0, expenseShare: 0, balance: 0 };
                        const hasMoney = personData.balance >= 0;
                        return (
                          <div 
                            key={name}
                            className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800"
                          >
                            <div className="flex justify-between items-center mb-2.5">
                              <div className="flex items-center space-x-2.5">
                                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
                                  {name.substring(0, 2)}
                                </div>
                                <span className="font-bold text-sm text-slate-850 dark:text-white">{name}</span>
                              </div>
                              <span className={`text-sm font-extrabold px-3 py-1 rounded-full text-xs ${hasMoney ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400'}`}>
                                {hasMoney ? '' : '-'}{formatCurrency(Math.abs(personData.balance))}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-50 dark:border-slate-800/40 text-xs">
                              <div>
                                <span className="text-slate-400 font-medium">Deposited: </span>
                                <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(personData.deposited)}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-slate-400 font-medium">Spent: </span>
                                <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(personData.expenseShare)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ADD TRANSACTION */}
              {activeTab === 'add' && (
                <div className="space-y-4">
                  <div className="flex bg-slate-150 dark:bg-slate-800 p-1 rounded-xl mb-2">
                    <button 
                      onClick={() => setActiveAddSection('expense')}
                      className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeAddSection === 'expense' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      Expense Section
                    </button>
                    <button 
                      onClick={() => setActiveAddSection('deposit')}
                      className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeAddSection === 'deposit' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      Deposit Section
                    </button>
                  </div>

                  {activeAddSection === 'expense' ? (
                    <form onSubmit={handleAddExpense} className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-4">
                      <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 font-bold text-sm mb-2">
                        <ArrowUpRight size={16} />
                        <span>Add Expense Record</span>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Amount (₹)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={expenseAmount}
                          onChange={(e) => setExpenseAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-2.5 rounded-xl font-bold text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Purpose</label>
                        <input 
                          type="text" 
                          value={expensePurpose}
                          onChange={(e) => setExpensePurpose(e.target.value)}
                          placeholder="e.g. WiFi Bill, Groceries, Dinner"
                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-2.5 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Paid By</label>
                          <select 
                            value={expensePaidBy}
                            onChange={(e) => setExpensePaidBy(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-3 py-2.5 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {summary.roommates && summary.roommates.map(name => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Date</label>
                          <input 
                            type="date" 
                            value={expenseDate}
                            onChange={(e) => setExpenseDate(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-3 py-2.5 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Split Among</label>
                          <div className="space-x-2">
                            <button 
                              type="button" 
                              onClick={() => setExpenseSplitAmong(summary.roommates)}
                              className="text-[10px] font-bold text-indigo-500 hover:underline"
                            >
                              All
                            </button>
                            <button 
                              type="button" 
                              onClick={() => setExpenseSplitAmong([])}
                              className="text-[10px] font-bold text-slate-400 hover:underline"
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {summary.roommates && summary.roommates.map(name => {
                            const isIncluded = expenseSplitAmong.includes(name);
                            return (
                              <button
                                type="button"
                                key={name}
                                onClick={() => handleToggleSplit(!isIncluded, name)}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${isIncluded ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-850' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-750'}`}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <button 
                        type="submit"
                        className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-xl text-xs shadow-md hover:bg-indigo-700 transition-all flex items-center justify-center space-x-1.5 pt-4"
                      >
                        <PlusCircle size={14} />
                        <span>Add Expense Record</span>
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleAddDeposit} className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-4">
                      <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm mb-2">
                        <ArrowDownLeft size={16} />
                        <span>Add Room Deposit</span>
                      </div>

                      <div className="p-3.5 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl text-slate-700 dark:text-slate-350 text-xs leading-relaxed space-y-1.5">
                        <p className="font-bold text-indigo-700 dark:text-indigo-400">Flexible Payment Options:</p>
                        <p>Enter the amount and tap below. You will be able to choose <strong className="font-semibold text-slate-800 dark:text-white">Google Pay, PhonePe, Paytm, or any UPI app</strong> without any default hijacking.</p>
                        <p className="text-[11px] text-slate-400">Paying to Room UPI: <strong className="font-mono text-indigo-600 dark:text-indigo-300">{summary.upiId}</strong></p>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Amount (₹)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-4 py-2.5 rounded-xl font-bold text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Deposit Date</label>
                        <input 
                          type="date" 
                          value={depositDate}
                          onChange={(e) => setDepositDate(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-3 py-2.5 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      <button 
                        type="submit"
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold py-3.5 px-4 rounded-xl text-xs shadow-md hover:from-emerald-600 hover:to-teal-600 transition-all flex items-center justify-center space-x-1.5 pt-4"
                      >
                        <Wallet size={14} />
                        <span>Continue to Pay & Choose App</span>
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* TAB 3: TRANSACTION HISTORY */}
              {activeTab === 'history' && (
                <div className="space-y-4">
                  <div className="flex bg-slate-150 dark:bg-slate-800 p-1 rounded-xl mb-1">
                    <button 
                      onClick={() => setActiveHistorySection('expense')}
                      className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeHistorySection === 'expense' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      Expense History
                    </button>
                    <button 
                      onClick={() => setActiveHistorySection('deposit')}
                      className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeHistorySection === 'deposit' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      Deposit History
                    </button>
                  </div>

                  {activeHistorySection === 'expense' ? (
                    <div className="space-y-4">
                      {/* Filter Option */}
                      <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm text-xs font-semibold">
                        <span className="flex items-center text-slate-400"><Filter size={12} className="mr-1.5" /> Filter by:</span>
                        <select
                          value={expenseFilter}
                          onChange={(e) => setExpenseFilter(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-800 text-xs border border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-2.5 font-bold focus:outline-none text-slate-700 dark:text-slate-200"
                        >
                          <option value="mine">My Expenses (Involved) ⭐</option>
                          <option value="all">All Roommates (Everyone)</option>
                          {summary.roommates && summary.roommates.filter(n => n?.toLowerCase() !== myName?.toLowerCase()).map(name => (
                            <option key={name} value={name}>{name}'s Expenses</option>
                          ))}
                        </select>
                      </div>

                      {/* Expense Card Groups */}
                      {groupExpensesByDate().length > 0 ? (
                        groupExpensesByDate().map(([dateStr, items]) => (
                          <div key={dateStr} className="space-y-2">
                            {/* Date Line Separator */}
                            <div className="flex items-center my-3">
                              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap bg-slate-100 dark:bg-slate-950 px-2 rounded-md">
                                {formatDate(dateStr)}
                              </span>
                              <div className="w-full border-b border-slate-200 dark:border-slate-800 ml-2"></div>
                            </div>

                            {items.map(exp => (
                              <div 
                                key={exp.id}
                                className={`bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border ${editingExpenseId === exp.id ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-100 dark:border-slate-800'}`}
                              >
                                {editingExpenseId !== exp.id ? (
                                  <div>
                                    {/* Top Row: Purpose & Total Amount */}
                                    <div className="flex justify-between items-start">
                                      <h5 className="font-bold text-slate-850 dark:text-white text-sm leading-snug flex-1 pr-2">
                                        {exp.purpose}
                                      </h5>
                                      <div className="text-right flex flex-col items-end space-y-1">
                                        <span className="font-extrabold text-sm text-rose-600 dark:text-rose-450">
                                          {formatCurrency(exp.amount)}
                                        </span>
                                        <div className="flex space-x-1.5 pt-0.5">
                                          <button 
                                            onClick={() => startEditExpense(exp)}
                                            className="p-1 rounded bg-slate-50 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 hover:text-indigo-600 transition-all"
                                            title="Edit"
                                          >
                                            <Edit3 size={11} />
                                          </button>
                                          <button 
                                            onClick={() => initiateDelete('expense', exp.id, exp.purpose)}
                                            className="p-1 rounded bg-slate-50 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 hover:text-rose-600 transition-all"
                                            title="Delete"
                                          >
                                            <Trash2 size={11} />
                                          </button>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Clean 3-Row Information Section */}
                                    <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
                                      {/* 1. Paid by */}
                                      <div className="flex items-center">
                                        <span className="text-[11px] font-medium text-slate-400 w-24 flex-shrink-0">Paid by:</span>
                                        <span className="font-bold text-slate-750 dark:text-slate-200">
                                          {exp.paidBy}{exp.paidBy?.toLowerCase() === myName?.toLowerCase() ? ' (You)' : ''}
                                        </span>
                                      </div>

                                      {/* 2. Split among */}
                                      <div className="flex items-start">
                                        <span className="text-[11px] font-medium text-slate-400 w-24 flex-shrink-0 pt-0.5">Split among:</span>
                                        <span className="font-semibold text-slate-700 dark:text-slate-300 leading-relaxed">
                                          {exp.splitAmong && exp.splitAmong.length > 0 
                                            ? exp.splitAmong.map(p => p.toLowerCase() === myName?.toLowerCase() ? `${p} (You)` : p).join(', ')
                                            : 'All roommates'}
                                        </span>
                                      </div>

                                      {/* 3. Each (Highlighted) */}
                                      <div className="flex items-center pt-0.5">
                                        <span className="text-[11px] font-medium text-slate-400 w-24 flex-shrink-0">Each:</span>
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-black bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200/70 dark:border-indigo-800/60 shadow-sm">
                                          {formatCurrency(exp.amount / (exp.splitAmong?.length || 1))}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[9px] uppercase font-bold text-slate-400">Amount</label>
                                        <input 
                                          type="number" 
                                          value={editExpenseAmount}
                                          onChange={(e) => setEditExpenseAmount(e.target.value)}
                                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs font-bold"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[9px] uppercase font-bold text-slate-400">Purpose</label>
                                        <input 
                                          type="text" 
                                          value={editExpensePurpose}
                                          onChange={(e) => setEditExpensePurpose(e.target.value)}
                                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                                        />
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[9px] uppercase font-bold text-slate-400">Paid By</label>
                                        <select 
                                          value={editExpensePaidBy}
                                          onChange={(e) => setEditExpensePaidBy(e.target.value)}
                                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs font-semibold"
                                        >
                                          {summary.roommates.map(name => (
                                            <option key={name} value={name}>{name}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[9px] uppercase font-bold text-slate-400">Date</label>
                                        <input 
                                          type="date" 
                                          value={editExpenseDate}
                                          onChange={(e) => setEditExpenseDate(e.target.value)}
                                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                                        />
                                      </div>
                                    </div>

                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-slate-400 block mb-1">Split Among</label>
                                      <div className="flex flex-wrap gap-1">
                                        {summary.roommates.map(name => {
                                          const isIncluded = editExpenseSplit.includes(name);
                                          return (
                                            <button
                                              type="button"
                                              key={name}
                                              onClick={() => handleToggleEditSplit(!isIncluded, name)}
                                              className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${isIncluded ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800' : 'bg-slate-55 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'}`}
                                            >
                                              {name}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    <div className="flex justify-end space-x-2 pt-1">
                                      <button 
                                        onClick={() => saveEditExpense(exp.id)}
                                        className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-emerald-700 transition-all flex items-center space-x-1"
                                      >
                                        <Save size={10} />
                                        <span>Save</span>
                                      </button>
                                      <button 
                                        onClick={() => setEditingExpenseId(null)}
                                        className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-slate-300 dark:hover:bg-slate-750 transition-all"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-12 text-xs text-slate-400 font-semibold bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800">
                          No expenses matching this selection.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Filter Option */}
                      <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm text-xs font-semibold">
                        <span className="flex items-center text-slate-400"><Filter size={12} className="mr-1.5" /> Filter by:</span>
                        <select
                          value={depositFilter}
                          onChange={(e) => setDepositFilter(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-800 text-xs border border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-2.5 font-bold focus:outline-none text-slate-700 dark:text-slate-200"
                        >
                          <option value="mine">My Deposits ⭐</option>
                          <option value="all">All Roommates (Everyone)</option>
                          {summary.roommates && summary.roommates.filter(n => n?.toLowerCase() !== myName?.toLowerCase()).map(name => (
                            <option key={name} value={name}>{name}'s Deposits</option>
                          ))}
                        </select>
                      </div>

                      {/* Deposit Card Groups */}
                      {groupDepositsByDate().length > 0 ? (
                        groupDepositsByDate().map(([dateStr, items]) => (
                          <div key={dateStr} className="space-y-2">
                            {/* Date Line Separator */}
                            <div className="flex items-center my-3">
                              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap bg-slate-100 dark:bg-slate-950 px-2 rounded-md">
                                {formatDate(dateStr)}
                              </span>
                              <div className="w-full border-b border-slate-200 dark:border-slate-800 ml-2"></div>
                            </div>

                            {items.map(dep => (
                              <div 
                                key={dep.id}
                                className={`bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border ${editingDepositId === dep.id ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-100 dark:border-slate-800'}`}
                              >
                                {editingDepositId !== dep.id ? (
                                  <div className="flex justify-between items-center">
                                    <div className="space-y-0.5">
                                      <div className="flex items-center space-x-1.5">
                                        <h5 className="font-bold text-slate-850 dark:text-white text-sm">{dep.depositedBy}</h5>
                                        {dep.depositedBy?.toLowerCase() === myName?.toLowerCase() && (
                                          <span className="text-[9px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-md font-bold border border-indigo-200/60 dark:border-indigo-800/60">
                                            You
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[10px] text-slate-400 font-medium">Deposit</p>
                                    </div>
                                    <div className="text-right flex flex-col items-end space-y-2">
                                      <span className="font-extrabold text-sm text-emerald-600 dark:text-emerald-450">
                                        +{formatCurrency(dep.amount)}
                                      </span>
                                      
                                      <div className="flex space-x-2 pt-0.5">
                                        <button 
                                          onClick={() => startEditDeposit(dep)}
                                          className="p-1 rounded bg-slate-50 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 hover:text-indigo-600 transition-all"
                                          title="Edit"
                                        >
                                          <Edit3 size={11} />
                                        </button>
                                        <button 
                                          onClick={() => initiateDelete('deposit', dep.id, `${dep.depositedBy}'s deposit`)}
                                          className="p-1 rounded bg-slate-50 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 hover:text-rose-600 transition-all"
                                          title="Delete"
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[9px] uppercase font-bold text-slate-400">Amount</label>
                                        <input 
                                          type="number" 
                                          value={editDepositAmount}
                                          onChange={(e) => setEditDepositAmount(e.target.value)}
                                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs font-bold"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[9px] uppercase font-bold text-slate-400">Depositor</label>
                                        <select 
                                          value={editDepositBy}
                                          onChange={(e) => setEditDepositBy(e.target.value)}
                                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs font-semibold"
                                        >
                                          {summary.roommates.map(name => (
                                            <option key={name} value={name}>{name}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>

                                    <div>
                                      <label className="text-[9px] uppercase font-bold text-slate-400">Date</label>
                                      <input 
                                        type="date" 
                                        value={editDepositDate}
                                        onChange={(e) => setEditDepositDate(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                                      />
                                    </div>

                                    <div className="flex justify-end space-x-2 pt-1">
                                      <button 
                                        onClick={() => saveEditDeposit(dep.id)}
                                        className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-emerald-700 transition-all flex items-center space-x-1"
                                      >
                                        <Save size={10} />
                                        <span>Save</span>
                                      </button>
                                      <button 
                                        onClick={() => setEditingDepositId(null)}
                                        className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-slate-300 dark:hover:bg-slate-750 transition-all"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-12 text-xs text-slate-400 font-semibold bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800">
                          No deposits matching this selection.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: SETTINGS */}
              {activeTab === 'settings' && (
                <div className="space-y-4">
                  {/* Shared Notes (Accessible to Everyone) */}
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-2">
                      <div className="flex items-center space-x-1.5 text-slate-700 dark:text-white font-bold text-xs">
                        <FileText size={14} className="text-indigo-500" />
                        <span>Shared Room Notes</span>
                      </div>
                      <button 
                        onClick={handleSaveNotes}
                        disabled={notesSaving}
                        className="text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-150 px-2.5 py-1 rounded-lg hover:bg-indigo-100 transition-all disabled:opacity-50"
                      >
                        {notesSaving ? "Saving..." : "Save Notes"}
                      </button>
                    </div>
                    <textarea 
                      value={sharedNotes}
                      onChange={(e) => setSharedNotes(e.target.value)}
                      rows={3}
                      placeholder="e.g. WiFi key, landlord phone, shopping checklists..."
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white p-3 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-normal"
                    />
                  </div>

                  {/* Dark Mode Theme Selection */}
                  <div className="bg-white dark:bg-slate-900 px-5 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <div className="flex items-center space-x-2 text-slate-750 dark:text-white font-bold text-xs">
                      {isDarkMode ? <Moon size={14} className="text-indigo-400" /> : <Sun size={14} className="text-amber-500" />}
                      <span>Dark Theme Toggle</span>
                    </div>
                    <button 
                      onClick={() => setIsDarkMode(!isDarkMode)}
                      className={`w-11 h-6 rounded-full relative transition-all duration-200 ${isDarkMode ? 'bg-indigo-600' : 'bg-slate-200'}`}
                      aria-label="Toggle dark mode"
                    >
                      <span className={`w-4 h-4 rounded-full bg-white absolute top-1 left-1 transition-all duration-200 ${isDarkMode ? 'translate-x-5' : ''}`}></span>
                    </button>
                  </div>

                  {/* Admin Specific Settings */}
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-4">
                    <div className="flex items-center space-x-1.5 text-slate-700 dark:text-white font-bold text-xs border-b border-slate-50 dark:border-slate-800 pb-2">
                      <Users size={14} className="text-indigo-500" />
                      <span>Roommates List ({summary.roommates?.length || 0})</span>
                    </div>

                    <div className="space-y-2">
                      {summary.roommates && summary.roommates.map(name => {
                        const isThisAdmin = name === summary.adminName;
                        return (
                          <div 
                            key={name}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold"
                          >
                            <span className="text-slate-800 dark:text-slate-350">{name} {isThisAdmin && <span className="text-[10px] text-indigo-500 font-bold ml-1">(Admin)</span>}</span>
                            {/* Member deletion (Admin only, cannot delete self) */}
                            {isAdmin && !isThisAdmin && (
                              <button 
                                onClick={() => initiateDelete('member', '', name)}
                                className="text-slate-400 hover:text-rose-600 transition-all p-1"
                                title="Remove roommate"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Edit Room Details (Admin Only) */}
                  {isAdmin ? (
                    <form onSubmit={handleSaveSettings} className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-4">
                      <div className="flex items-center space-x-1.5 text-slate-750 dark:text-white font-bold text-xs border-b border-slate-50 dark:border-slate-800 pb-2">
                        <Settings size={14} className="text-indigo-500" />
                        <span>Edit Room Configurations</span>
                      </div>

                      {settingsError && (
                        <div className="p-2 bg-rose-50 dark:bg-rose-950/20 text-rose-600 text-[10px] font-bold rounded-lg text-center">
                          {settingsError}
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Room Name</label>
                        <input 
                          type="text" 
                          value={roomSettingsName}
                          onChange={(e) => setRoomSettingsName(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-3 py-2 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Room Code (Cannot clash)</label>
                        <input 
                          type="text" 
                          value={roomSettingsCode}
                          onChange={(e) => setRoomSettingsCode(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-3 py-2 rounded-xl text-xs font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">UPI ID (IOB)</label>
                        <input 
                          type="text" 
                          value={roomSettingsUpi}
                          onChange={(e) => setRoomSettingsUpi(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-850 dark:text-white px-3 py-2 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      <button 
                        type="submit"
                        disabled={settingsSaving}
                        className="w-full bg-indigo-650 text-white font-bold py-2.5 px-3 rounded-xl text-xs hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center space-x-1"
                      >
                        <Save size={12} />
                        <span>{settingsSaving ? "Updating..." : "Save Settings"}</span>
                      </button>
                    </form>
                  ) : (
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="flex items-center space-x-1.5 text-slate-750 dark:text-white font-bold text-xs border-b border-slate-50 dark:border-slate-800 pb-2">
                        <Settings size={14} className="text-indigo-500" />
                        <span>Room Configurations</span>
                      </div>
                      <div className="space-y-2 pt-1 text-xs">
                        <p><span className="text-slate-400 font-medium">Room Name:</span> <strong className="text-slate-750 dark:text-slate-350">{summary.roomName}</strong></p>
                        <p><span className="text-slate-400 font-medium">Room Code:</span> <strong className="text-slate-755 dark:text-slate-350 font-mono">{summary.roomCode}</strong></p>
                        <p><span className="text-slate-400 font-medium">Deposits UPI ID:</span> <strong className="text-slate-755 dark:text-slate-350 font-mono">{summary.upiId}</strong></p>
                        <p className="text-[10px] text-slate-400 italic pt-1">Only the Admin ({summary.adminName}) can edit room settings.</p>
                      </div>
                    </div>
                  )}

                  {/* Switch Room Option */}
                  <button 
                    onClick={() => { setCurrentSession(null); setLoginMode('enter'); }}
                    className="w-full py-3.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-250 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5"
                  >
                    <PlusCircle size={14} />
                    <span>Create or Enter Another Room</span>
                  </button>

                  {/* Exit Room Button */}
                  <button 
                    onClick={handleExitRoom}
                    className="w-full py-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/50 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5"
                  >
                    <LogOut size={14} />
                    <span>Exit Current Room</span>
                  </button>
                </div>
              )}
            </>
          )}
        </main>

        {/* FIXED BOTTOM NAVIGATION BAR (Never slides or shifts while scrolling) */}
        <footer className="fixed sm:absolute bottom-0 inset-x-0 sm:max-w-md sm:mx-auto bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 h-16 flex items-center justify-around px-2 z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom,0px)]">
          <button 
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center space-y-1 w-14 py-2 transition-all ${activeTab === 'home' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-550'}`}
          >
            <Home size={18} />
            <span className="text-[9px] font-bold tracking-wider">Home</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('add')}
            className="flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white w-12 h-12 rounded-2xl shadow-lg -translate-y-4 transition-all duration-200 transform active:scale-95"
            aria-label="Add transaction"
          >
            <Plus size={24} />
          </button>
          
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center justify-center space-y-1 w-14 py-2 transition-all ${activeTab === 'history' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-550'}`}
          >
            <History size={18} />
            <span className="text-[9px] font-bold tracking-wider">History</span>
          </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center space-y-1 w-14 py-2 transition-all ${activeTab === 'settings' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-550'}`}
          >
            <Settings size={18} />
            <span className="text-[9px] font-bold tracking-wider">Settings</span>
          </button>
        </footer>

        {/* SIDE MENU (DRAWER) OVERLAY */}
        {showSideMenu && (
          <div className="absolute inset-0 bg-slate-950/40 z-50 transition-opacity">
            <div className="w-64 h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col p-4 space-y-4 animate-slide-in">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">My Joined Rooms</span>
                <button 
                  onClick={() => setShowSideMenu(false)}
                  className="p-1 rounded bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 dark:text-slate-400"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Rooms list */}
              <div className="flex-1 overflow-y-auto scrollbar-hide space-y-2">
                {joinedRooms.length > 0 ? (
                  joinedRooms.map(room => (
                    <button
                      key={room.roomId}
                      onClick={() => handleSwitchRoom(room)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-all text-xs font-semibold ${currentSession.roomId === room.roomId ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-150' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-750 border border-transparent'}`}
                    >
                      <div className="truncate pr-2">
                        <div className="font-bold">{room.roomName}</div>
                        <div className="text-[10px] font-mono text-slate-400 font-medium tracking-wide mt-0.5">{room.roomCode}</div>
                      </div>
                      <ChevronRight size={12} className={currentSession.roomId === room.roomId ? 'text-indigo-600' : 'text-slate-400'} />
                    </button>
                  ))
                ) : (
                  <p className="text-center py-10 text-xs text-slate-400">No other joined rooms.</p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => { setCurrentSession(null); setShowSideMenu(false); }}
                  className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-750 transition-all flex items-center justify-center space-x-1.5"
                >
                  <PlusCircle size={12} />
                  <span>Join/Create New Room</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* UPI PAYMENT APP CHOOSER & QR MODAL */}
        {upiPaymentModal.show && (
          <div className="fixed sm:absolute inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-150 dark:border-slate-800 flex flex-col space-y-3.5 my-auto max-h-[92vh] overflow-y-auto scrollbar-hide">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="text-left">
                  <h4 className="text-sm font-extrabold text-slate-850 dark:text-white">Pay Deposit</h4>
                  <p className="text-[10px] text-slate-400">Choose your payment app</p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-450 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 rounded-xl border border-emerald-100 dark:border-emerald-800/50">
                    {formatCurrency(upiPaymentModal.amount)}
                  </span>
                </div>
              </div>

              {/* Quick App Launcher Buttons (Fixes iPhone WhatsApp auto-open) */}
              <div className="space-y-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block text-left">
                  Tap to pay directly:
                </span>
                
                <div className="grid grid-cols-2 gap-2">
                  {/* Google Pay */}
                  <button
                    onClick={() => openPaymentApp('gpay')}
                    className="flex items-center justify-center space-x-1.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 transition-all font-bold text-xs text-slate-800 dark:text-white shadow-sm active:scale-95"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                    <span>Google Pay</span>
                  </button>

                  {/* PhonePe */}
                  <button
                    onClick={() => openPaymentApp('phonepe')}
                    className="flex items-center justify-center space-x-1.5 p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/30 hover:bg-indigo-100/50 text-indigo-700 dark:text-indigo-300 transition-all font-bold text-xs shadow-sm active:scale-95"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block"></span>
                    <span>PhonePe</span>
                  </button>

                  {/* Paytm */}
                  <button
                    onClick={() => openPaymentApp('paytm')}
                    className="flex items-center justify-center space-x-1.5 p-2.5 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/30 hover:bg-sky-100/50 text-sky-700 dark:text-sky-300 transition-all font-bold text-xs shadow-sm active:scale-95"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block"></span>
                    <span>Paytm</span>
                  </button>

                  {/* Any Other UPI App */}
                  <button
                    onClick={() => openPaymentApp('upi')}
                    className="flex items-center justify-center space-x-1.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all font-bold text-xs shadow-sm active:scale-95"
                  >
                    <ExternalLink size={12} className="text-slate-500" />
                    <span>Other UPI</span>
                  </button>
                </div>
              </div>

              {/* Copy UPI ID Box */}
              <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-2xl border border-slate-100 dark:border-slate-750 flex items-center justify-between">
                <div className="truncate pr-2 text-left">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Room UPI ID</span>
                  <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 truncate block">
                    {summary.upiId}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyUpi}
                  className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                    copiedUpi
                      ? 'bg-emerald-600 text-white'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {copiedUpi ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedUpi ? "Copied!" : "Copy"}</span>
                </button>
              </div>

              {/* Toggle QR Code */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowModalQr(!showModalQr)}
                  className="w-full py-1.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center justify-center space-x-1"
                >
                  <QrCode size={12} />
                  <span>{showModalQr ? "Hide QR Code" : "Or Scan QR Code"}</span>
                </button>

                {showModalQr && (
                  <div className="mt-2 p-3 bg-white rounded-2xl border border-slate-200 shadow-inner flex flex-col items-center justify-center">
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(upiPaymentModal.upiLink)}`}
                      alt="UPI QR Code" 
                      className="w-36 h-36"
                    />
                    <p className="text-[9px] text-slate-400 mt-1.5">Scan with any UPI app</p>
                  </div>
                )}
              </div>

              {/* Confirmation Actions */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <button
                  onClick={confirmUpiDepositAdded}
                  className="w-full bg-emerald-600 text-white py-2.5 px-4 rounded-xl text-xs font-extrabold hover:bg-emerald-700 transition-all shadow-md active:scale-98 flex items-center justify-center space-x-1.5"
                >
                  <CheckCircle size={14} />
                  <span>I Have Paid (Record Deposit)</span>
                </button>

                <button
                  onClick={() => { setUpiPaymentModal({ show: false, upiLink: '', amount: '' }); setShowModalQr(false); }}
                  className="w-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 py-2 px-3 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-750 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DELETE CONFIRMATION DIALOG */}
        {deleteConfirm.show && (
          <div className="absolute inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-150 dark:border-slate-850 text-center space-y-4">
              <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-full flex items-center justify-center text-rose-600 mx-auto">
                <Trash2 size={20} />
              </div>
              
              <div>
                <h4 className="text-sm font-bold text-slate-800 dark:text-white">Confirm Removal</h4>
                <p className="text-[11px] text-slate-400 mt-1 leading-normal px-2">
                  Are you sure you want to delete <strong className="text-slate-600 dark:text-slate-300 font-semibold">{deleteConfirm.name || deleteConfirm.type}</strong>? This action is permanent and stored on Supabase.
                </p>
              </div>

              <div className="flex space-x-2.5 pt-2">
                <button
                  onClick={confirmDelete}
                  className="flex-1 bg-rose-600 text-white py-2 px-3 rounded-xl text-xs font-bold hover:bg-rose-700 transition-all"
                >
                  Delete
                </button>
                <button
                  onClick={() => setDeleteConfirm({ show: false, type: '', id: '', name: '' })}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-605 dark:text-slate-400 py-2 px-3 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-750 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
