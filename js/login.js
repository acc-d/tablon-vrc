import supabase from "./supabase.js";

const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const loginMessage = document.querySelector("#login-message");

async function redirectIfLoggedIn() {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (session) {
    window.location.replace("./admin.html");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginButton.disabled = true;
  loginMessage.textContent = "Comprobando datos…";
  loginMessage.className = "message";

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw error;
    }

    window.location.replace("./admin.html");
  } catch (error) {
    console.error(error);

    loginMessage.textContent =
      "No se pudo iniciar sesión. Comprueba el correo y la contraseña.";

    loginMessage.className = "message message--error";
  } finally {
    loginButton.disabled = false;
  }
});

redirectIfLoggedIn();