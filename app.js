const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors({
  origin: 'https://stbudgetappfrontend.z16.web.core.windows.net',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Connexion MongoDB
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db;

async function connectToMongoDB() {
  try {
    console.log('Tentative de connexion à MongoDB...');
    await client.connect();
    console.log('MongoDB connected successfully');
    db = client.db('budgetDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

// Routes
// GET tous les budgets
app.get('/api/budgets', async (req, res) => {
  try {
    const budgets = await db.collection('budgets').find().sort({ month: -1 }).toArray();
    res.json(budgets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET un budget spécifique
app.get('/api/budgets/:id', async (req, res) => {
  try {
    const budget = await db.collection('budgets').findOne({ _id: new ObjectId(req.params.id) });
    if (!budget) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    res.json(budget);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET le budget du mois courant ou le plus récent
app.get('/api/budgets/current/month', async (req, res) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7); // Format YYYY-MM
    let budget = await db.collection('budgets').findOne({ month: currentMonth });
    
    if (!budget) {
      // Si pas de budget pour le mois courant, renvoyer le plus récent
      const budgets = await db.collection('budgets').find().sort({ month: -1 }).limit(1).toArray();
      budget = budgets[0] || null;
    }
    
    if (!budget) {
      return res.status(404).json({ message: 'No budget found' });
    }
    
    res.json(budget);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST créer un nouveau budget
app.post('/api/budgets', async (req, res) => {
  try {
    const { month, name, income, categories } = req.body;
    
    // Vérifier si un budget existe déjà pour ce mois
    const existingBudget = await db.collection('budgets').findOne({ month });
    if (existingBudget) {
      return res.status(400).json({ message: `A budget for ${month} already exists` });
    }
    
    const newBudget = {
      month,
      name,
      income,
      categories,
      expenses: [],
      createdAt: new Date()
    };
    
    const result = await db.collection('budgets').insertOne(newBudget);
    res.status(201).json({ ...newBudget, _id: result.insertedId });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT mettre à jour un budget
app.put('/api/budgets/:id', async (req, res) => {
  try {
    const { month, name, income, categories } = req.body;
    
    // Si on change le mois, vérifier qu'il n'y a pas déjà un budget pour ce mois
    if (month) {
      const budget = await db.collection('budgets').findOne({ _id: new ObjectId(req.params.id) });
      if (budget.month !== month) {
        const existingBudget = await db.collection('budgets').findOne({ month });
        if (existingBudget) {
          return res.status(400).json({ message: `A budget for ${month} already exists` });
        }
      }
    }
    
    const result = await db.collection('budgets').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { month, name, income, categories, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    
    res.json(result.value);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE supprimer un budget
app.delete('/api/budgets/:id', async (req, res) => {
  try {
    const result = await db.collection('budgets').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    
    res.json({ message: 'Budget deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST ajouter une dépense à un budget
app.post('/api/budgets/:id/expenses', async (req, res) => {
  try {
    const { date, category, description, amount } = req.body;
    
    // Valider les données
    if (!date || !category || !description || amount === undefined) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Créer une dépense avec un ID unique
    const expense = {
      _id: new ObjectId(),
      date,
      category,
      description,
      amount,
      createdAt: new Date()
    };
    
    // Ajouter la dépense au budget
    const result = await db.collection('budgets').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $push: { expenses: expense } },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    
    res.status(201).json(expense);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE supprimer une dépense d'un budget
app.delete('/api/budgets/:budgetId/expenses/:expenseId', async (req, res) => {
  try {
    const { budgetId, expenseId } = req.params;
    
    const result = await db.collection('budgets').findOneAndUpdate(
      { _id: new ObjectId(budgetId) },
      { $pull: { expenses: { _id: new ObjectId(expenseId) } } },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ message: 'Budget or expense not found' });
    }
    
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET statistiques pour un budget
app.get('/api/budgets/:id/stats', async (req, res) => {
  try {
    const budget = await db.collection('budgets').findOne({ _id: new ObjectId(req.params.id) });
    
    if (!budget) {
      return res.status(404).json({ message: 'Budget not found' });
    }
    
    // Calculer les statistiques
    const totalPlanned = budget.categories.reduce((sum, cat) => sum + cat.planned, 0);
    const totalSpent = budget.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const remaining = budget.income - totalSpent;
    
    // Dépenses par catégorie
    const expensesByCategory = {};
    budget.expenses.forEach(expense => {
      if (!expensesByCategory[expense.category]) {
        expensesByCategory[expense.category] = 0;
      }
      expensesByCategory[expense.category] += expense.amount;
    });
    
    // Comparer dépenses planifiées vs réelles
    const categoryComparison = budget.categories.map(category => {
      const spent = expensesByCategory[category.name] || 0;
      return {
        name: category.name,
        planned: category.planned,
        spent,
        difference: category.planned - spent
      };
    });
    
    res.json({
      totalPlanned,
      totalSpent,
      remaining,
      savingsRate: (remaining / budget.income) * 100,
      expensesByCategory,
      categoryComparison
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Route de test de base
app.get('/', (req, res) => {
  res.send('Budget Planner API is running');
});

// Connexion à la base de données puis démarrage du serveur
connectToMongoDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});