import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
    createUserWithEmailAndPassword,
    getAuth,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signOut
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    onSnapshot,
    serverTimestamp,
    setDoc,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: 'AIzaSyCXHRZoIXssNc1ycYwoTQfcKxpwS-JlPRU',
    authDomain: 'track-record-708da.firebaseapp.com',
    projectId: 'track-record-708da',
    storageBucket: 'track-record-708da.firebasestorage.app',
    messagingSenderId: '524604794783',
    appId: '1:524604794783:web:599283a2a3579d6c337faa'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let writeQueue = Promise.resolve();
const entriesCacheByUser = new Map();

const ready = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, user => {
        unsubscribe();
        resolve(user);
    }, reject);
});

function entriesCollection(userId) {
    return collection(db, 'users', userId, 'entries');
}

function entryDocumentId(entry, index, usedIds) {
    const baseId = encodeURIComponent(String(entry.id || `entry-${index}`)).slice(0, 120);
    let documentId = baseId || `entry-${index}`;
    let duplicateIndex = 1;
    while (usedIds.has(documentId)) documentId = `${baseId}-${index}-${duplicateIndex++}`;
    usedIds.add(documentId);
    return documentId;
}

function saveData(user, entries, creditRules) {
    const snapshot = JSON.parse(JSON.stringify({ entries, creditRules }));
    const operation = writeQueue.catch(() => {}).then(async () => {
        const userRef = doc(db, 'users', user.uid);
        const entriesRef = entriesCollection(user.uid);
        const existingById = entriesCacheByUser.get(user.uid);
        if (!existingById) {
            throw new Error('Cloud data has not been loaded for this account yet. Reload the app and try again.');
        }
        const desiredIds = new Set();
        const nextEntries = new Map();
        const writes = [];

        snapshot.entries.forEach((entry, index) => {
            const documentId = entryDocumentId(entry, index, desiredIds);

            const payload = { ...entry, id: entry.id || `entry-${index}`, position: index };
            nextEntries.set(documentId, payload);
            const existingEntry = existingById.get(documentId);
            if (!existingEntry || JSON.stringify(existingEntry) !== JSON.stringify(payload)) {
                writes.push({ type: 'set', reference: doc(entriesRef, documentId), payload });
            }
        });

        existingById.forEach((entry, documentId) => {
            if (!desiredIds.has(documentId)) {
                writes.push({ type: 'delete', reference: doc(entriesRef, documentId) });
            }
        });

        for (let offset = 0; offset < writes.length; offset += 450) {
            const batch = writeBatch(db);
            writes.slice(offset, offset + 450).forEach(write => {
                if (write.type === 'delete') batch.delete(write.reference);
                else batch.set(write.reference, write.payload);
            });
            await batch.commit();
        }

        entriesCacheByUser.set(user.uid, nextEntries);
        await setDoc(userRef, {
            creditRules: snapshot.creditRules,
            updatedAt: serverTimestamp()
        }, { merge: true });
    });
    writeQueue = operation;
    return operation;
}

async function loadData(user) {
    const [profileSnapshot, entriesSnapshot] = await Promise.all([
        getDoc(doc(db, 'users', user.uid)),
        getDocs(entriesCollection(user.uid))
    ]);
    const entries = entriesSnapshot.docs
        .map(entryDoc => {
            const { position, ...entry } = entryDoc.data();
            return { entry, position: Number.isInteger(position) ? position : Number.MAX_SAFE_INTEGER };
        })
        .sort((a, b) => a.position - b.position)
        .map(item => ({ ...item.entry, id: item.entry.id || 'entry' }));
    const cachedEntries = new Map();
    entriesSnapshot.docs.forEach(entryDoc => cachedEntries.set(entryDoc.id, entryDoc.data()));
    entriesCacheByUser.set(user.uid, cachedEntries);
    return {
        exists: profileSnapshot.exists() || entries.length > 0,
        entries,
        creditRules: profileSnapshot.data()?.creditRules || null
    };
}

function subscribeData(user, callback, onError) {
    let profile = null;
    let entries = [];
    let hasProfile = false;
    let hasEntries = false;
    const emit = () => {
        if (!hasProfile || !hasEntries) return;
        callback({ entries, creditRules: profile?.creditRules || null });
    };
    const unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), snapshot => {
        profile = snapshot.exists() ? snapshot.data() : null;
        hasProfile = true;
        emit();
    }, onError);
    const unsubscribeEntries = onSnapshot(entriesCollection(user.uid), snapshot => {
        const cachedEntries = new Map(snapshot.docs.map(entryDoc => [entryDoc.id, entryDoc.data()]));
        entriesCacheByUser.set(user.uid, cachedEntries);
        entries = snapshot.docs
            .map(entryDoc => {
                const { position, ...entry } = entryDoc.data();
                return { entry, position: Number.isInteger(position) ? position : Number.MAX_SAFE_INTEGER };
            })
            .sort((a, b) => a.position - b.position)
            .map(item => ({ ...item.entry, id: item.entry.id || 'entry' }));
        hasEntries = true;
        emit();
    }, onError);
    return () => {
        unsubscribeProfile();
        unsubscribeEntries();
    };
}

window.trackRecordCloud = {
    ready,
    createAccount: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signOut: () => signOut(auth),
    resetPassword: email => sendPasswordResetEmail(auth, email),
    onAuthStateChanged: callback => onAuthStateChanged(auth, callback),
    getCurrentUser: () => auth.currentUser,
    loadData,
    saveData,
    subscribeData
};
